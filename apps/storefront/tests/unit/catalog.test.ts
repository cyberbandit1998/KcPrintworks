import { describe, expect, it } from 'vitest';
import { ProductSchema, priceLine, toSummary } from '@kcpw/contracts';
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
