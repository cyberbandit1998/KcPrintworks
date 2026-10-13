import { describe, expect, it } from 'vitest';
import {
  ProductSchema,
  expandVariations,
  priceLine,
  toPurchaseModel,
  toSummary,
} from '@kcpw/contracts';
import { categories, products } from '@/lib/catalog/fixtures';
import { fixtureCatalog } from '@/lib/catalog/fixture-source';
import { optionAvailability } from '@/lib/variation';

describe('fixture catalog', () => {
  it('validates against the same schema WooCommerce data must satisfy', () => {
    for (const p of products) expect(ProductSchema.safeParse(p).success).toBe(true);
  });

  it('has unique ids and slugs, and every category reference resolves', () => {
    expect(new Set(products.map((p) => p.id)).size).toBe(products.length);
    expect(new Set(products.map((p) => p.slug)).size).toBe(products.length);
    const slugs = new Set(categories.map((c) => c.slug));
    for (const p of products) for (const c of p.categories) expect(slugs.has(c.slug)).toBe(true);
  });

  it('covers the shapes the design must handle', () => {
    expect(products.some((p) => p.type === 'variable')).toBe(true);
    expect(products.some((p) => p.optionSchema.fields.length === 0)).toBe(true);
    expect(products.some((p) => p.availability.stockStatus === 'outofstock')).toBe(true);
    expect(products.some((p) => p.regularPrice && p.regularPrice.amount > p.price.amount)).toBe(
      true,
    );
    expect(products.some((p) => p.availability.madeToOrder)).toBe(true);
    expect(products.some((p) => !p.availability.madeToOrder)).toBe(true);
  });

  it('never leaks Etsy fields into the storefront DTO', () => {
    for (const p of products) expect(JSON.stringify(p).toLowerCase()).not.toContain('etsy');
  });

  it('serves lookups through the CatalogSource interface', async () => {
    expect((await fixtureCatalog.getProductBySlug('sample-custom-poster'))?.id).toBe(102);
    expect(await fixtureCatalog.getProductBySlug('nope')).toBeUndefined();
    expect((await fixtureCatalog.listProductsInCategory('bags')).map((p) => p.slug)).toEqual([
      'sample-tote-bag',
    ]);
  });

  it('summaries flag personalizable products', () => {
    const summary = products.map(toSummary);
    expect(summary.find((s) => s.slug === 'sample-sticker-pack')?.personalizable).toBe(false);
    expect(summary.find((s) => s.slug === 'sample-personalized-print')?.personalizable).toBe(true);
  });
});

describe('fixture pricing through the reference logic', () => {
  it('prices the tote with a percent back-print on the variation price', async () => {
    const tote = await fixtureCatalog.getProductBySlug('sample-tote-bag');
    const q = priceLine(tote, {
      productId: 104,
      variationId: 1041,
      quantity: 2,
      options: { initials: 'ADA', backprint: 'logo' },
    });
    expect(q.issues).toEqual([]);
    expect(q.optionAdders.amount).toBe(330); // 15% of $22.00
    expect(q.lineTotal.amount).toBe((2200 + 330) * 2);
  });
});

describe('variation availability', () => {
  const poster = products.find((p) => p.slug === 'sample-custom-poster')!;

  it('marks a sold-out combination given the other selection', () => {
    expect(optionAvailability(poster, 'finish', 'gloss', { size: 'large' })).toBe('soldout');
    expect(optionAvailability(poster, 'finish', 'matte', { size: 'large' })).toBe('ok');
  });

  it('marks nonexistent combinations unavailable', () => {
    expect(optionAvailability(poster, 'size', 'huge', {})).toBe('unavailable');
  });
});

describe('"Any" variations in the fixture catalog', () => {
  const tag = products.find((p) => p.slug === 'sample-name-tag')!;

  it('has a single priced variation whose attributes are all "Any"', () => {
    expect(tag.variations).toHaveLength(1);
    expect(Object.values(tag.variations[0]!.attributes)).toEqual(['', '']);
  });

  it('keeps every offered option selectable because an "Any" variation fits all of them', () => {
    expect(optionAvailability(tag, 'tag-color', 'red', {})).toBe('ok');
    expect(optionAvailability(tag, 'tag-color', 'blue', { 'text-color': 'gray' })).toBe('ok');
  });
});

type Selection = Record<string, string>;

describe('bag tag: the same product two ways', () => {
  const asImported = products.find((p) => p.slug === 'sample-bag-tag-as-imported')!;
  const asOptions = products.find((p) => p.slug === 'sample-bag-tag')!;
  const poster = products.find((p) => p.slug === 'sample-custom-poster')!;

  it('as imported: 169 "Any" variations reach the browser as one row', () => {
    expect(asImported.variations).toHaveLength(169);
    const model = toPurchaseModel(asImported);
    expect(model.variations.rows).toHaveLength(1);
    expect(JSON.stringify(model).length).toBeLessThan(JSON.stringify(asImported).length / 10);
  });

  it('as imported: shows exactly the same availability for every option as the full product', () => {
    const model = toPurchaseModel(asImported);
    const lookup = { variations: expandVariations(model) };
    for (const attr of asImported.attributes) {
      for (const option of attr.options) {
        for (const selection of [
          {},
          { 'text-color': 'red' },
          { 'tag-color': 'navy' },
        ] as Selection[]) {
          expect(optionAvailability(lookup, attr.slug, option.slug, selection)).toBe(
            optionAvailability(asImported, attr.slug, option.slug, selection),
          );
        }
      }
    }
  });

  it('every availability answer survives compaction on the sold-out poster too', () => {
    const lookup = { variations: expandVariations(toPurchaseModel(poster)) };
    for (const attr of poster.attributes) {
      for (const option of attr.options) {
        for (const selection of [
          {},
          { size: 'large' },
          { finish: 'gloss' },
          { size: 'small' },
        ] as Selection[]) {
          expect(optionAvailability(lookup, attr.slug, option.slug, selection)).toBe(
            optionAvailability(poster, attr.slug, option.slug, selection),
          );
        }
      }
    }
  });

  it('as options: no variations, and every choice is kept with the order line', () => {
    expect(asOptions.type).toBe('simple');
    expect(asOptions.variations).toEqual([]);
    const quote = priceLine(asOptions, {
      productId: asOptions.id,
      quantity: 1,
      options: {
        tag_color: 'navy',
        text_color: 'white',
        cable_color: 'silver',
        icon: 'paw',
        name: 'Robin',
      },
    });
    expect(quote.issues).toEqual([]);
    expect(quote.optionSummary).toEqual([
      { fieldId: 'tag_color', label: 'Tag color', value: 'Navy' },
      { fieldId: 'text_color', label: 'Text color', value: 'White' },
      { fieldId: 'cable_color', label: 'Cable color', value: 'Silver' },
      { fieldId: 'icon', label: 'Icon', value: 'Paw' },
      { fieldId: 'name', label: 'Name or short text', value: 'Robin' },
    ]);
  });

  it('as options: rejects a color that is not offered and a missing required choice', () => {
    const quote = priceLine(asOptions, {
      productId: asOptions.id,
      quantity: 1,
      options: {
        tag_color: 'chartreuse',
        text_color: 'white',
        cable_color: 'silver',
        name: 'Robin',
      },
    });
    expect(quote.issues.length).toBeGreaterThan(0);
    const missing = priceLine(asOptions, {
      productId: asOptions.id,
      quantity: 1,
      options: { tag_color: 'navy', text_color: 'white', name: 'Robin' },
    });
    expect(missing.issues.length).toBeGreaterThan(0);
  });
});
