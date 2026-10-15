import {
  OptionSchemaSchema,
  ProductSchema,
  type Category,
  type OptionSchema,
  type Product,
  type ProductAttribute,
  type StockStatus,
  type Variation,
} from '@kcpw/contracts';
import { isMadeToOrder, proposedOptions, readHiddenAttributes } from '../display-policy';
import {
  decodeEntities,
  descriptionHtml,
  excerpt,
  plainText,
  sanitizeTitle,
  toMinorUnits,
} from '../export/text';
import type { WooCategory, WooProduct, WooVariation } from './rest-schema';

/**
 * WooCommerce REST v3 -> storefront DTO. Real slugs, prices, option lists, variation IDs, photos, and categories come
 * straight from WooCommerce, so product URLs and variation IDs are preserved. Marketplace attributes (Condition, MPN, ...)
 * are hidden from DISPLAY only; nothing is changed in WooCommerce.
 *
 * Personalization: a structured schema in the product's `_kcpw_option_schema` meta (written by the future kcpw-core
 * module) is used when present and valid; until then products that say they are personalized get PROPOSED fields.
 */

export const OPTION_SCHEMA_META = '_kcpw_option_schema';

export interface WooCatalogInput {
  products: WooProduct[];
  variations: ReadonlyMap<number, WooVariation[]>;
  categories: WooCategory[];
}

export interface WooCatalogResult {
  products: Product[];
  categories: Category[];
  skipped: { id: number; title: string; reason: string }[];
  proposedPersonalization: number;
  /** The products that show the default personalization fields because WooCommerce stores no setup for them (the shop will not accept those choices until it does). */
  defaultPersonalization: { id: number; name: string }[];
}

const toStock = (value: string): StockStatus =>
  value === 'outofstock' ? 'outofstock' : value === 'onbackorder' ? 'onbackorder' : 'instock';

function uniqueSlugs(names: string[]): string[] {
  const taken = new Set<string>();
  return names.map((name) => {
    const base = sanitizeTitle(name) || 'option';
    let slug = base;
    for (let n = 2; taken.has(slug); n += 1) slug = `${base}-${n}`;
    taken.add(slug);
    return slug;
  });
}

function schemaFromMeta(product: WooProduct): OptionSchema | undefined {
  const raw = product.meta_data.find((m) => m.key === OPTION_SCHEMA_META)?.value;
  if (typeof raw !== 'string' && (typeof raw !== 'object' || raw === null)) return undefined;
  try {
    const parsed = OptionSchemaSchema.safeParse(typeof raw === 'string' ? JSON.parse(raw) : raw);
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

function prices(source: {
  price: string;
  regular_price: string;
  sale_price: string;
  on_sale: boolean;
}) {
  const price =
    toMinorUnits(source.price) ??
    toMinorUnits(source.sale_price) ??
    toMinorUnits(source.regular_price);
  if (price === undefined) return undefined;
  const regular = toMinorUnits(source.regular_price);
  return {
    price: { amount: price, currency: 'USD' },
    regularPrice:
      source.on_sale && regular !== undefined && regular > price
        ? { amount: regular, currency: 'USD' }
        : undefined,
  };
}

const isoUtc = (value: string) => (value.endsWith('Z') ? value : `${value}Z`);

/** The product's published (created) date as ISO UTC, or the epoch when WooCommerce sent none. */
function publishedAt(row: WooProduct): string {
  const gmt = row.date_created_gmt.trim();
  if (gmt) return isoUtc(gmt);
  const local = row.date_created.trim(); // no timezone given: treated as UTC, only the ORDER matters
  return local ? isoUtc(local) : new Date(0).toISOString();
}

/** WooCommerce's own average and count, only when there is at least one rating. Nothing is computed or invented here. */
function ratingSummary(row: WooProduct): Product['rating'] {
  const average = Number.parseFloat(row.average_rating);
  if (row.rating_count < 1 || !Number.isFinite(average) || average < 0 || average > 5) {
    return undefined;
  }
  return { average: Math.round(average * 100) / 100, count: row.rating_count };
}

export function convertWooCatalog(
  input: WooCatalogInput,
  hiddenAttributes: ReadonlySet<string> = readHiddenAttributes(),
): WooCatalogResult {
  const skipped: WooCatalogResult['skipped'] = [];
  const products: Product[] = [];
  let proposedPersonalization = 0;
  const defaultPersonalization: { id: number; name: string }[] = [];
  const takenSlugs = new Set<string>();

  for (const row of input.products) {
    const title = decodeEntities(row.name).trim();
    if (row.status !== 'publish') {
      skipped.push({ id: row.id, title, reason: `status is ${row.status || 'unknown'}` });
      continue;
    }
    if (row.catalog_visibility === 'hidden') {
      skipped.push({ id: row.id, title, reason: 'hidden from the catalog' });
      continue;
    }
    if (row.type !== 'simple' && row.type !== 'variable') {
      skipped.push({ id: row.id, title, reason: `product type "${row.type}" is not supported` });
      continue;
    }

    // ---- attributes
    const variationNames = new Set(
      row.attributes.filter((a) => a.variation).map((a) => a.name.toLowerCase()),
    );
    const attributes: ProductAttribute[] = [];
    const attrSlugByName = new Map<string, string>();
    const attrSlugs = uniqueSlugs(row.attributes.map((a) => a.name));
    row.attributes.forEach((a, index) => {
      const lower = a.name.toLowerCase();
      const forVariation = variationNames.has(lower);
      if (!forVariation && (hiddenAttributes.has(lower) || !a.visible)) return;
      const names = a.options.map((o) => decodeEntities(o).trim()).filter(Boolean);
      if (names.length === 0) return; // an attribute with no options cannot be offered
      const optionSlugs = uniqueSlugs(names);
      attrSlugByName.set(lower, attrSlugs[index]!);
      attributes.push({
        slug: attrSlugs[index]!,
        name: decodeEntities(a.name),
        usedForVariations: forVariation,
        options: names.map((name, i) => ({ slug: optionSlugs[i]!, name })),
      });
    });
    const variationAttributes = attributes.filter((a) => a.usedForVariations);

    // ---- variations (disabled ones are private in WooCommerce and are not sold)
    const variations: Variation[] = [];
    if (row.type === 'variable') {
      for (const v of input.variations.get(row.id) ?? []) {
        if (v.status !== 'publish') continue;
        const vp = prices(v) ?? prices(row);
        if (!vp) continue;
        const chosen = new Map(
          v.attributes.map((a) => [a.name.toLowerCase(), decodeEntities(a.option).trim()]),
        );
        const selection: Record<string, string> = {};
        let valid = true;
        for (const attr of variationAttributes) {
          const option =
            [...chosen].find(([name]) => attrSlugByName.get(name) === attr.slug)?.[1] ?? '';
          if (option === '') {
            selection[attr.slug] = ''; // WooCommerce "Any"
            continue;
          }
          const key = sanitizeTitle(option);
          const match = attr.options.find((o) => o.slug === key || sanitizeTitle(o.name) === key);
          if (!match) {
            valid = false;
            break;
          }
          selection[attr.slug] = match.slug;
        }
        if (!valid) continue;
        variations.push({
          id: v.id,
          sku: v.sku || undefined,
          attributes: selection,
          price: vp.price,
          regularPrice: vp.regularPrice,
          stockStatus: toStock(v.stock_status),
        });
      }
      if (variations.length === 0) {
        skipped.push({
          id: row.id,
          title,
          reason: 'variable product with no purchasable variations',
        });
        continue;
      }
    }

    const base =
      row.type === 'variable'
        ? {
            price: variations.reduce(
              (lo, v) => (v.price.amount < lo.amount ? v.price : lo),
              variations[0]!.price,
            ),
            regularPrice: undefined,
          }
        : prices(row);
    if (!base) {
      skipped.push({ id: row.id, title, reason: 'no price' });
      continue;
    }

    // ---- personalization, availability, text
    const fromMeta = schemaFromMeta(row);
    const proposed = proposedOptions(title);
    if (!fromMeta && proposed.proposed) {
      proposedPersonalization += 1;
      defaultPersonalization.push({ id: row.id, name: title });
    }
    const madeToOrder = isMadeToOrder({
      attributes: row.attributes,
      tags: row.tags,
      meta: row.meta_data,
    });
    const html = descriptionHtml(row.description);
    const text = plainText(html);

    let slug = row.slug || sanitizeTitle(title) || `product-${row.id}`;
    if (takenSlugs.has(slug)) slug = `${slug}-${row.id}`;
    takenSlugs.add(slug);

    const candidate = {
      id: row.id,
      slug,
      type: row.type,
      name: title,
      descriptionHtml: html,
      shortDescription: plainText(descriptionHtml(row.short_description)),
      sku: row.sku || undefined,
      price: base.price,
      regularPrice: base.regularPrice,
      images: row.images
        .filter((i) => i.src)
        .map((i, index) => ({
          id: i.id || row.id * 100 + index,
          url: i.src,
          alt: decodeEntities(i.alt || i.name || title),
          // WooCommerce does not report dimensions; square only matters until the photo has loaded.
          width: 1000,
          height: 1000,
        })),
      categories: row.categories.map((c) => ({
        id: c.id,
        slug: c.slug,
        name: decodeEntities(c.name),
      })),
      attributes,
      variations,
      optionSchema: fromMeta ?? proposed.schema,
      availability: {
        purchasable: true,
        stockStatus:
          row.type === 'variable'
            ? variations.some((v) => v.stockStatus !== 'outofstock')
              ? ('instock' as const)
              : ('outofstock' as const)
            : toStock(row.stock_status),
        madeToOrder,
      },
      seo: { title: excerpt(title, 70), description: excerpt(text || title, 155), noindex: false },
      updatedAt: row.date_modified_gmt
        ? row.date_modified_gmt.endsWith('Z')
          ? row.date_modified_gmt
          : `${row.date_modified_gmt}Z`
        : new Date(0).toISOString(),
      featured: row.featured,
      publishedAt: publishedAt(row),
      menuOrder: row.menu_order,
      rating: ratingSummary(row),
      reviewsAllowed: row.reviews_allowed,
    };
    const parsed = ProductSchema.safeParse(candidate);
    if (!parsed.success) {
      skipped.push({
        id: row.id,
        title,
        reason: `does not fit the storefront contract: ${parsed.error.issues[0]?.message ?? 'unknown'}`,
      });
      continue;
    }
    products.push(parsed.data);
  }

  // EVERY WooCommerce category is kept, with its parent: a parent such as "Game Cases" may hold no product of its own and still
  // has to exist (its children's products belong to it). Which categories are shown where is decided by the catalog queries.
  const categories: Category[] = input.categories.map((c) => {
    const description = plainText(c.description);
    return {
      id: c.id,
      slug: c.slug,
      name: decodeEntities(c.name),
      description,
      seo: {
        title: decodeEntities(c.name),
        description: excerpt(
          description || `Browse ${decodeEntities(c.name)} at KCPrintWorks.`,
          155,
        ),
        noindex: false,
      },
      parentId: c.parent,
      menuOrder: c.menu_order,
      imageUrl: c.image?.src || undefined,
    };
  });
  return { products, categories, skipped, proposedPersonalization, defaultPersonalization };
}
