import { describe, expect, it } from 'vitest';
import {
  ProductSchema,
  expandVariations,
  findVariation,
  money,
  toPurchaseModel,
  type Product,
} from '../src';

const COLORS = Array.from({ length: 13 }, (_, i) => ({
  slug: `c${i + 1}`,
  name: `Color ${i + 1}`,
}));
const img = { id: 1, url: '/x.svg', alt: 'x', width: 800, height: 800 };

/** A 13 x 13 tag. `build` decides each of the 169 variations from its two color indexes. */
function matrixProduct(
  build: (tag: number, text: number) => Product['variations'][number]['attributes'] & object,
  extra: (tag: number, text: number) => Partial<Product['variations'][number]> = () => ({}),
): Product {
  const variations: Product['variations'] = [];
  for (let tag = 0; tag < 13; tag++) {
    for (let text = 0; text < 13; text++) {
      variations.push({
        id: 5000 + tag * 13 + text,
        sku: `TAG-${tag}-${text}`,
        attributes: build(tag, text),
        price: money(800),
        stockStatus: 'instock',
        stockQuantity: 15,
        ...extra(tag, text),
      });
    }
  }
  return ProductSchema.parse({
    id: 7,
    slug: 'tag',
    type: 'variable',
    name: 'Tag',
    descriptionHtml: '<p>' + 'A long description. '.repeat(200) + '</p>',
    shortDescription: 'short',
    sku: 'TAG',
    price: money(800),
    images: [img, img, img],
    categories: [],
    attributes: [
      { slug: 'tag', name: 'Tag Color', usedForVariations: true, options: COLORS },
      { slug: 'text', name: 'Text Color', usedForVariations: true, options: COLORS },
    ],
    variations,
    optionSchema: { version: 1, fields: [] },
    availability: { purchasable: true, stockStatus: 'instock', madeToOrder: true, leadTimeDays: 4 },
    seo: {
      title: 'Tag',
      description: 'A tag with a long SEO description. '.repeat(10),
      noindex: false,
    },
    updatedAt: '2026-10-13T00:00:00Z',
  });
}

/** Worst case: every one of the 169 combinations is its own variation with its own price and stock. */
const distinct = () =>
  matrixProduct(
    (tag, text) => ({ tag: COLORS[tag]!.slug, text: COLORS[text]!.slug }),
    (tag, text) => ({
      price: money(800 + tag * 13 + text),
      stockStatus: (tag + text) % 7 === 0 ? 'outofstock' : 'instock',
    }),
  );

/** The shape found in the real export: 169 variations, every attribute blank ("Any"). */
const allAny = () => matrixProduct(() => ({ tag: '', text: '' }));

const json = (value: unknown) => JSON.stringify(value).length;

describe('toPurchaseModel', () => {
  it('resolves every one of 169 selections exactly as the full product does', () => {
    const product = distinct();
    const model = toPurchaseModel(product);
    const lookup = { attributes: model.attributes, variations: expandVariations(model) };
    for (const t of COLORS) {
      for (const x of COLORS) {
        const selection = { tag: t.slug, text: x.slug };
        const full = findVariation(product, selection);
        const compact = findVariation(lookup, selection);
        expect(full).toBeDefined();
        expect(compact?.id).toBe(full?.id);
        expect(compact?.price).toEqual(full?.price);
        expect(compact?.stockStatus).toBe(full?.stockStatus);
      }
    }
  });

  it('collapses 169 interchangeable "Any" variations to one without changing any answer', () => {
    const product = allAny();
    const model = toPurchaseModel(product);
    expect(model.variations.rows).toHaveLength(1);
    const lookup = { attributes: model.attributes, variations: expandVariations(model) };
    for (const t of COLORS) {
      for (const x of COLORS) {
        const selection = { tag: t.slug, text: x.slug };
        expect(findVariation(lookup, selection)?.price).toEqual(
          findVariation(product, selection)?.price,
        );
      }
    }
    expect(findVariation(lookup, { tag: 'c1' })).toBeUndefined(); // still requires every choice
  });

  it('merges only rows that are interchangeable', () => {
    const product = matrixProduct(
      () => ({ tag: '', text: '' }),
      (tag, text) => {
        if (tag === 0 && text === 0) return { stockStatus: 'outofstock' as const };
        if (tag === 0 && text === 1) return { price: money(900) };
        if (tag === 0 && text === 2) return { regularPrice: money(1000) };
        return {};
      },
    );
    const model = toPurchaseModel(product);
    // 1 plain row, plus one each that differs in stock, price, or regular price.
    expect(model.variations.rows).toHaveLength(4);
  });

  it('keeps a specific variation ahead of an "Any" fallback with the same price', () => {
    const product = matrixProduct(
      (tag, text) => (tag === 0 && text === 0 ? { tag: 'c1', text: 'c1' } : { tag: '', text: '' }),
      (tag, text) => (tag === 0 && text === 0 ? { stockStatus: 'outofstock' as const } : {}),
    );
    const model = toPurchaseModel(product);
    const lookup = { attributes: model.attributes, variations: expandVariations(model) };
    expect(findVariation(lookup, { tag: 'c1', text: 'c1' })?.stockStatus).toBe('outofstock');
    expect(findVariation(lookup, { tag: 'c1', text: 'c2' })?.stockStatus).toBe('instock');
  });

  it('drops a variation whose value is not an offered option instead of widening it to "Any"', () => {
    const product = distinct();
    // Bypass the schema, which would reject this, to model corrupted upstream data.
    const broken: Product = {
      ...product,
      variations: [
        { ...product.variations[0]!, id: 1, attributes: { tag: 'ghost', text: '' } },
        ...product.variations,
      ],
    };
    const model = toPurchaseModel(broken);
    expect(model.variations.rows.some((row) => row[0] === 1)).toBe(false);
    const lookup = { attributes: model.attributes, variations: expandVariations(model) };
    expect(findVariation(lookup, { tag: 'c1', text: 'c1' })?.id).toBe(5000);
  });

  it('carries only what the form reads', () => {
    const model = toPurchaseModel(distinct());
    const text = JSON.stringify(model);
    for (const leak of ['descriptionHtml', 'A long description', 'seo', 'images', 'TAG-', 'sku']) {
      expect(text).not.toContain(leak);
    }
    expect(Object.keys(model).sort()).toEqual(
      [
        'attributes',
        'availability',
        'id',
        'name',
        'optionSchema',
        'price',
        'regularPrice',
        'type',
        'variations',
      ].sort(),
    );
  });
});

describe('payload and CPU budgets (large variation lists)', () => {
  it('sends the worst case 169 distinct variations in under 8 KB, a fraction of the full product', () => {
    const product = distinct();
    const compact = json(toPurchaseModel(product));
    expect(compact).toBeLessThan(8 * 1024);
    expect(compact).toBeLessThan(json(product) / 4);
  });

  it('sends the as-imported 169 "Any" variations in under 2 KB', () => {
    expect(json(toPurchaseModel(allAny()))).toBeLessThan(2 * 1024);
  });

  it('expands and resolves all 169 selections well inside a frame budget', () => {
    const model = toPurchaseModel(distinct());
    const start = performance.now();
    const lookup = { attributes: model.attributes, variations: expandVariations(model) };
    for (const t of COLORS)
      for (const x of COLORS) findVariation(lookup, { tag: t.slug, text: x.slug });
    // Generous so shared CI runners do not flake; a regression to something quadratic-and-slow still trips it.
    expect(performance.now() - start).toBeLessThan(100);
  });
});
