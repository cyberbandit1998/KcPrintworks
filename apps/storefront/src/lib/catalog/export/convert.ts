import {
  ProductSchema,
  type Category,
  type Product,
  type ProductAttribute,
  type ProductImage,
  type StockStatus,
  type Variation,
} from '@kcpw/contracts';
import type { ExportRow } from './csv';
import {
  decodeEntities,
  descriptionHtml,
  excerpt,
  plainText,
  sanitizeTitle,
  toMinorUnits,
} from './text';
import { MARKETPLACE_ATTRIBUTES, proposedOptions } from '../display-policy';

/**
 * Turns a WooCommerce product export into storefront DTOs, for the DESIGN PREVIEW only.
 *
 * What the export does and does not contain decides what is real here:
 *   real    titles, prices, descriptions, image URLs, attributes and their option lists, variation shape,
 *           stock status, categories, the made-to-order marker
 *   derived URL slugs (the export has no permalinks), image alt text and size, category descriptions, SEO text
 *   proposed personalization fields (the export has no structured personalization)
 * Every derived or proposed value is reported in `notes`, and the preview banner says so.
 */

export interface ConvertOptions {
  /** Where each product's category comes from. `current` = the store as it is; `proposed` = the reviewed plan. */
  categories: 'current' | 'proposed';
  /** product id -> proposed category (name and slug), from docs/discovery/category-plan.csv. */
  categoryPlan?: ReadonlyMap<string, { name: string; slug: string }>;
  /** Product ids to leave out (proposed duplicate retirements). Nothing is changed in the store. */
  hide?: ReadonlySet<string>;
  /** Replace photo URLs with local placeholders (for a sandbox that cannot reach the live site). */
  placeholderImages?: boolean;
  now?: Date;
}

export interface ConvertResult {
  products: Product[];
  categories: Category[];
  notes: string[];
  skipped: { id: string; title: string; reason: string }[];
}

const PLACEHOLDER_FILES = [
  'print-a.svg',
  'print-b.svg',
  'poster.svg',
  'cards.svg',
  'mug.svg',
  'tote.svg',
];

const attrCells = (row: ExportRow) =>
  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    .map((i) => ({
      name: decodeEntities((row[`Attribute ${i} name`] ?? '').trim()),
      value: (row[`Attribute ${i} value(s)`] ?? '').trim(),
    }))
    .filter((a) => a.name);

/** WooCommerce joins option values with ", " and escapes a comma inside a value as "\,". */
function splitValues(value: string): string[] {
  if (value === '') return [];
  return value
    .split(/(?<!\\),\s*/)
    .map((v) => decodeEntities(v.replace(/\\,/g, ',').trim()))
    .filter(Boolean);
}

function uniqueSlug(base: string, taken: Set<string>, fallbackSuffix: string): string {
  const root = (base || 'item').slice(0, 110).replace(/-+$/, '') || 'item';
  let slug = root;
  if (taken.has(slug)) slug = `${root}-${fallbackSuffix}`;
  let n = 2;
  while (taken.has(slug)) slug = `${root}-${fallbackSuffix}-${n++}`;
  taken.add(slug);
  return slug;
}

function stockOf(row: ExportRow): StockStatus {
  const v = (row['In stock?'] ?? '').trim().toLowerCase();
  if (v === '0') return 'outofstock';
  if (v === 'backorder') return 'onbackorder';
  return 'instock';
}

function salePriceActive(row: ExportRow, now: Date): boolean {
  if (toMinorUnits(row['Sale price'] ?? '') === undefined) return false;
  const starts = Date.parse(row['Date sale price starts'] ?? '');
  const ends = Date.parse(row['Date sale price ends'] ?? '');
  if (!Number.isNaN(starts) && starts > now.getTime()) return false;
  if (!Number.isNaN(ends) && ends + 86_400_000 < now.getTime()) return false;
  return true;
}

function pricesOf(row: ExportRow, now: Date, currency = 'USD') {
  const regular = toMinorUnits(row['Regular price'] ?? '');
  const sale = salePriceActive(row, now) ? toMinorUnits(row['Sale price'] ?? '') : undefined;
  const effective = sale ?? regular;
  if (effective === undefined) return undefined;
  return {
    price: { amount: effective, currency },
    regularPrice:
      sale !== undefined && regular !== undefined && regular > sale
        ? { amount: regular, currency }
        : undefined,
  };
}

function imagesOf(
  row: ExportRow,
  name: string,
  options: ConvertOptions,
  seed: number,
): ProductImage[] {
  const urls = (row.Images ?? '')
    .split(/,\s*(?=https?:\/\/|\/)/)
    .map((u) => u.trim())
    .filter(Boolean);
  const count = Math.max(urls.length, 0);
  return Array.from({ length: count }, (_, i) => {
    const placeholder = PLACEHOLDER_FILES[(seed + i) % PLACEHOLDER_FILES.length]!;
    return {
      id: seed * 100 + i,
      url: options.placeholderImages ? `/fixtures/${placeholder}` : urls[i]!,
      // The export carries no alt text or dimensions. Square is a guess that only matters before the photo loads.
      alt: i === 0 ? name : `${name} (photo ${i + 1})`,
      width: 1000,
      height: 1000,
    };
  });
}

export function convertExport(rows: ExportRow[], options: ConvertOptions): ConvertResult {
  const now = options.now ?? new Date();
  const notes: string[] = [];
  const skipped: ConvertResult['skipped'] = [];

  const tops = rows.filter(
    (r) => (r.Type === 'simple' || r.Type === 'variable') && r.Published === '1',
  );
  const byId = new Map(tops.map((r) => [r.ID!, r]));
  const bySku = new Map(tops.filter((r) => r.SKU).map((r) => [r.SKU!, r]));
  const kids = new Map<string, ExportRow[]>();
  for (const v of rows.filter((r) => r.Type === 'variation' && r.Published === '1')) {
    const parent = byId.get((v.Parent ?? '').replace(/^id:/, '')) ?? bySku.get(v.Parent ?? '');
    if (parent) kids.set(parent.ID!, [...(kids.get(parent.ID!) ?? []), v]);
  }

  // ---- categories
  const categoryRegistry = new Map<string, { id: number; slug: string; name: string }>();
  let nextCategoryId = 9001;
  const categoryFor = (name: string, slug?: string) => {
    const key = slug ?? sanitizeTitle(name);
    let entry = categoryRegistry.get(key);
    if (!entry) {
      entry = { id: nextCategoryId++, slug: key, name };
      categoryRegistry.set(key, entry);
    }
    return entry;
  };

  const takenSlugs = new Set<string>();
  const products: Product[] = [];
  let derivedSlugs = 0;
  let proposedPersonalization = 0;
  let attributesWithoutOptions = 0;

  const ordered = [...tops].sort(
    (a, b) =>
      Number(b['Is featured?'] === '1') - Number(a['Is featured?'] === '1') ||
      Number(a.Position || 0) - Number(b.Position || 0) ||
      Number(a.ID) - Number(b.ID),
  );

  for (const row of ordered) {
    const id = row.ID!;
    const title = decodeEntities(row.Name ?? '').trim();
    if (options.hide?.has(id)) {
      skipped.push({
        id,
        title,
        reason: 'hidden: proposed duplicate retirement (nothing changed in the store)',
      });
      continue;
    }
    if ((row['Visibility in catalog'] ?? 'visible') === 'hidden') {
      skipped.push({ id, title, reason: 'hidden from the catalog in WooCommerce' });
      continue;
    }

    const parentAttrs = attrCells(row);
    const variationRows = kids.get(id) ?? [];

    // Attributes that pick a variation are the ones the variation rows list.
    const variationAttrNames = new Set<string>();
    for (const v of variationRows)
      for (const a of attrCells(v)) variationAttrNames.add(a.name.toLowerCase());

    const attributes: ProductAttribute[] = [];
    const slugOfAttr = new Map<string, string>();
    const usedAttrSlugs = new Set<string>();
    for (const cell of parentAttrs) {
      const lower = cell.name.toLowerCase();
      const forVariation = variationAttrNames.has(lower);
      if (!forVariation && MARKETPLACE_ATTRIBUTES.has(lower)) continue; // hidden from display, left in WooCommerce
      const names = splitValues(cell.value);
      if (names.length === 0 && !forVariation) continue;
      const slug = uniqueSlug(sanitizeTitle(cell.name), usedAttrSlugs, 'attr');
      slugOfAttr.set(lower, slug);
      const optionSlugs = new Set<string>();
      attributes.push({
        slug,
        name: cell.name,
        usedForVariations: forVariation,
        options: names.map((n) => ({
          slug: uniqueSlug(sanitizeTitle(n), optionSlugs, 'opt'),
          name: n,
        })),
      });
    }
    // A variation attribute that the parent does not list: build its options from the variation values.
    for (const lower of variationAttrNames) {
      if (slugOfAttr.has(lower)) continue;
      const original = variationRows
        .flatMap(attrCells)
        .find((a) => a.name.toLowerCase() === lower)!.name;
      const names = [
        ...new Set(
          variationRows
            .flatMap(attrCells)
            .filter((a) => a.name.toLowerCase() === lower && a.value)
            .map((a) => decodeEntities(a.value)),
        ),
      ];
      const slug = uniqueSlug(sanitizeTitle(original), usedAttrSlugs, 'attr');
      slugOfAttr.set(lower, slug);
      const optionSlugs = new Set<string>();
      attributes.push({
        slug,
        name: original,
        usedForVariations: true,
        options: names.map((n) => ({
          slug: uniqueSlug(sanitizeTitle(n), optionSlugs, 'opt'),
          name: n,
        })),
      });
    }
    // WooCommerce lets an attribute be used for variations with no options listed. The DTO requires at
    // least one option to select, so such an attribute cannot be offered; say so instead of faking choices.
    for (let i = attributes.length - 1; i >= 0; i -= 1) {
      if (attributes[i]!.options.length === 0) {
        attributesWithoutOptions += 1;
        notes.push(
          `#${id}: attribute "${attributes[i]!.name}" has no option list in the export, so it is not offered.`,
        );
        attributes.splice(i, 1);
      }
    }
    const variationAttributes = attributes.filter((a) => a.usedForVariations);

    // ---- variations
    const variations: Variation[] = [];
    const parentPrices = pricesOf(row, now);
    if (row.Type === 'variable') {
      for (const v of variationRows) {
        const prices = pricesOf(v, now) ?? parentPrices;
        if (!prices) continue; // a variation with no price cannot be bought in WooCommerce either
        const chosen = new Map(
          attrCells(v).map((a) => [a.name.toLowerCase(), decodeEntities(a.value)]),
        );
        const selection: Record<string, string> = {};
        let valid = true;
        for (const attr of variationAttributes) {
          const lower = [...slugOfAttr].find(([, s]) => s === attr.slug)![0];
          const value = chosen.get(lower) ?? '';
          if (value === '') {
            selection[attr.slug] = ''; // blank = "Any" (UNVERIFIED until compared with the live store)
            continue;
          }
          const key = sanitizeTitle(value);
          const option = attr.options.find((o) => sanitizeTitle(o.name) === key || o.slug === key);
          if (!option) {
            valid = false;
            break;
          }
          selection[attr.slug] = option.slug;
        }
        if (!valid) continue;
        variations.push({
          id: Number(v.ID),
          sku: v.SKU || undefined,
          attributes: selection,
          price: prices.price,
          regularPrice: prices.regularPrice,
          stockStatus: stockOf(v),
        });
      }
    }

    const priceInfo =
      row.Type === 'variable' && variations.length > 0
        ? {
            price: variations.reduce(
              (lo, v) => (v.price.amount < lo.amount ? v.price : lo),
              variations[0]!.price,
            ),
            regularPrice: undefined,
          }
        : parentPrices;

    if (row.Type === 'variable' && variations.length === 0) {
      skipped.push({
        id,
        title,
        reason: 'variable product with no usable variations in the export',
      });
      continue;
    }
    if (!priceInfo) {
      skipped.push({ id, title, reason: 'no usable price in the export' });
      continue;
    }

    // ---- everything else
    const html = descriptionHtml(row.Description ?? '');
    const short = descriptionHtml(row['Short description'] ?? '');
    const text = plainText(html);
    const slug = uniqueSlug(sanitizeTitle(title), takenSlugs, id);
    derivedSlugs += 1;

    const madeToOrder = parentAttrs.some(
      (a) => a.name.toLowerCase() === 'condition' && /made_to_order/i.test(a.value),
    );
    const { schema, proposed } = proposedOptions(title);
    if (proposed) proposedPersonalization += 1;

    const currentCategories = (row.Categories ?? '')
      .split(',')
      .map((c) => decodeEntities(c.split('>').pop()!.trim()))
      .filter(Boolean);
    const plan = options.categoryPlan?.get(id);
    const categoryRefs =
      options.categories === 'proposed' && plan
        ? [categoryFor(plan.name, plan.slug)]
        : (currentCategories.length > 0 ? currentCategories : ['Uncategorized']).map((c) =>
            categoryFor(c),
          );

    const candidate = {
      id: Number(id),
      slug,
      type: row.Type as 'simple' | 'variable',
      name: title,
      descriptionHtml: html,
      shortDescription: plainText(short),
      sku: row.SKU || undefined,
      price: priceInfo.price,
      regularPrice: priceInfo.regularPrice,
      images: imagesOf(row, title, options, Number(id)),
      categories: categoryRefs.map((c) => ({ id: c.id, slug: c.slug, name: c.name })),
      attributes,
      variations,
      optionSchema: schema,
      availability: {
        purchasable: true,
        stockStatus:
          row.Type === 'variable'
            ? variations.some((v) => v.stockStatus !== 'outofstock')
              ? ('instock' as const)
              : ('outofstock' as const)
            : stockOf(row),
        madeToOrder,
      },
      seo: {
        title: excerpt(title, 70),
        description: excerpt(text || title, 155),
        noindex: false,
      },
      updatedAt: now.toISOString(),
    };
    const parsed = ProductSchema.safeParse(candidate);
    if (!parsed.success) {
      skipped.push({
        id,
        title,
        reason: `does not fit the storefront contract: ${parsed.error.issues[0]?.message ?? 'unknown'}`,
      });
      continue;
    }
    products.push(parsed.data);
  }

  const categories: Category[] = [...categoryRegistry.values()].map((c) => ({
    id: c.id,
    slug: c.slug,
    name: c.name,
    description: '',
    seo: { title: c.name, description: `Browse ${c.name} at KCPrintWorks.`, noindex: false },
  }));

  notes.unshift(
    `${products.length} published products converted; ${skipped.length} left out.`,
    `${derivedSlugs} product URLs are DERIVED from titles (the export has no permalinks). Real URLs need the live store.`,
    `${proposedPersonalization} products show PROPOSED personalization fields (the export has no structured personalization).`,
    options.placeholderImages
      ? 'Photos are replaced with placeholders (this environment cannot reach the live site).'
      : 'Photos load from the live site, so they appear only where that site is reachable.',
  );
  if (attributesWithoutOptions > 0)
    notes.push(`${attributesWithoutOptions} attributes had no options and were not offered.`);
  return { products, categories, notes, skipped };
}
