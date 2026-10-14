import { describe, expect, it } from 'vitest';
import { convertWooCatalog } from '@/lib/catalog/woo/convert';
import { isMadeToOrder, readHiddenAttributes } from '@/lib/catalog/display-policy';
import { priceLine } from '@kcpw/contracts';
import {
  WooProductSchema,
  WooVariationSchema,
  type WooProduct,
  type WooVariation,
} from '@/lib/catalog/woo/rest-schema';
import { createFixture } from '../support/woo-fixture.mjs';

/**
 * The storefront depends on WooCommerce's own data, not on whichever tool filled WooCommerce with products. These tests
 * pin that down: tools differ in extra meta, attribute vocabulary, SKU habits, and how they describe variations, and none
 * of that may change what shoppers see or what the cart does. (ADR-014, docs/SYNC-INDEPENDENCE.md.)
 */

function load(
  mutate: (
    products: Record<string, unknown>[],
    variations: Map<number, Record<string, unknown>[]>,
  ) => void = () => undefined,
) {
  const fixture = createFixture('http://127.0.0.1:3200');
  const products = structuredClone(fixture.products) as Record<string, unknown>[];
  const variations = new Map(
    [...fixture.variations].map(([id, rows]) => [
      id,
      structuredClone(rows) as Record<string, unknown>[],
    ]),
  );
  mutate(products, variations);
  const parsedProducts = products.map((p) => WooProductSchema.parse(p));
  const parsedVariations = new Map<number, WooVariation[]>(
    [...variations].map(([id, rows]) => [id, rows.map((v) => WooVariationSchema.parse(v))]),
  );
  return convertWooCatalog({
    products: parsedProducts as WooProduct[],
    variations: parsedVariations,
    categories: fixture.categories as never,
  });
}

const baseline = load();

describe('what a sync tool leaves lying around does not matter', () => {
  it('ignores unknown top-level fields and unknown meta on products and variations', () => {
    const noisy = load((products, variations) => {
      products.forEach((p, i) => {
        p['some_tool_field'] = { anything: i };
        (p['meta_data'] as unknown[]).push(
          { key: '_tool_a_listing_ref', value: `ref-${i}` },
          { key: '_tool_b_sync_state', value: { synced: true, at: '2026-10-01' } },
          { key: 'random_plugin_flag', value: 'yes' },
        );
      });
      for (const rows of variations.values())
        rows.forEach((v) => ((v as Record<string, unknown>)['tool_data'] = [1, 2, 3]));
    });
    expect(noisy.products).toEqual(baseline.products);
    expect(noisy.categories).toEqual(baseline.categories);
    expect(noisy.skipped).toEqual(baseline.skipped);
  });

  it('does not need any marketplace-style attributes to exist', () => {
    const clean = load((products) => {
      for (const p of products)
        p['attributes'] = (p['attributes'] as { name: string }[]).filter(
          (a) => !['Condition', 'MPN'].includes(a.name),
        );
    });
    expect(clean.products.length).toBe(baseline.products.length);
    expect(clean.products.find((p) => p.id === 102)?.attributes.map((a) => a.slug)).toEqual([
      'tag-color',
      'text-color',
    ]);
  });

  it('works the same whether or not the tool wrote SKUs, alt text, or sale dates', () => {
    const bare = load((products, variations) => {
      for (const p of products) {
        p['sku'] = '';
        for (const image of p['images'] as Record<string, unknown>[]) image['alt'] = '';
        p['date_modified_gmt'] = '';
      }
      for (const rows of variations.values()) rows.forEach((v) => (v['sku'] = ''));
    });
    const ids = bare.products.map((p) => p.id).sort();
    expect(ids).toEqual(baseline.products.map((p) => p.id).sort());
    const tag = bare.products.find((p) => p.id === 102)!;
    expect(tag.variations).toHaveLength(169);
    expect(tag.images[0]?.alt).toBeTruthy();
    expect(tag.updatedAt).toBe(new Date(0).toISOString());
  });

  it('handles variations written as specific options as well as "Any"', () => {
    const specific = load((_products, variations) => {
      // The same bag tag, but a tool that writes every combination out explicitly.
      const rows = variations.get(102)!;
      rows.slice(0, 4).forEach((v, i) => {
        v['attributes'] = [
          { name: 'Tag Color', option: ['Black', 'White', 'Red', 'Blue'][i] },
          { name: 'Text Color', option: 'White' },
        ];
      });
    });
    const tag = specific.products.find((p) => p.id === 102)!;
    expect(tag.variations.slice(0, 4).map((v) => v.attributes['tag-color'])).toEqual([
      'black',
      'white',
      'red',
      'blue',
    ]);
    expect(tag.variations[0]!.attributes['text-color']).toBe('white');
    // IDs are WooCommerce's, whatever the tool.
    expect(tag.variations[0]!.id).toBe(5000);
    // And the cart accepts both shapes.
    const fixed = priceLine(tag, { productId: 102, variationId: 5000, quantity: 1, options: {} });
    expect(fixed.issues).toEqual([]);
    const any = priceLine(tag, {
      productId: 102,
      variationId: 5010,
      quantity: 1,
      attributes: { 'tag-color': 'navy', 'text-color': 'red' },
      options: {},
    });
    expect(any.issues).toEqual([]);
  });

  it('keeps shopper-facing attributes when a tool uses marketplace vocabulary for them', () => {
    const hiddenNone = convertWooCatalog(
      { products: [], variations: new Map(), categories: [] },
      readHiddenAttributes({ CATALOG_HIDDEN_ATTRIBUTES: '' }),
    );
    expect(hiddenNone.products).toEqual([]);
    expect(readHiddenAttributes({ CATALOG_HIDDEN_ATTRIBUTES: ' Foo , BAR ' })).toEqual(
      new Set(['foo', 'bar']),
    );
    expect(readHiddenAttributes({}).has('mpn')).toBe(true);
    const shown = (() => {
      const fixture = createFixture();
      const parsed = fixture.products.map((p) => WooProductSchema.parse(p));
      return convertWooCatalog(
        { products: parsed, variations: new Map(), categories: [] },
        new Set(),
      );
    })();
    expect(shown.products.find((p) => p.id === 105)?.attributes.map((a) => a.name)).toEqual([
      'Condition',
      'MPN',
    ]);
    expect(baseline.products.find((p) => p.id === 105)?.attributes).toEqual([]);
  });
});

describe('"made to order" comes from WooCommerce-side markers, any one of which is enough', () => {
  const none = { attributes: [], tags: [], meta: [] };
  it('is false with no marker', () => expect(isMadeToOrder(none)).toBe(false));
  it('accepts the product tag', () =>
    expect(isMadeToOrder({ ...none, tags: [{ slug: 'made-to-order' }] })).toBe(true));
  it('accepts our own meta', () => {
    for (const value of ['1', 'yes', 'TRUE', true, 1])
      expect(
        isMadeToOrder({ ...none, meta: [{ key: '_kcpw_made_to_order', value }] }),
        String(value),
      ).toBe(true);
    for (const value of ['0', 'no', '', false])
      expect(
        isMadeToOrder({ ...none, meta: [{ key: '_kcpw_made_to_order', value }] }),
        String(value),
      ).toBe(false);
  });
  it('accepts a marketplace-style Condition value in several spellings', () => {
    for (const option of ['MADE_TO_ORDER', 'made_to_order', 'Made to order', 'made-to-order']) {
      expect(
        isMadeToOrder({ ...none, attributes: [{ name: 'Condition', options: [option] }] }),
        option,
      ).toBe(true);
    }
    expect(isMadeToOrder({ ...none, attributes: [{ name: 'Condition', options: ['NEW'] }] })).toBe(
      false,
    );
  });
});

describe('switching tools: what the cart does when products change identity', () => {
  it('a cart line for a product that no longer exists is reported, not crashed on', () => {
    const line = priceLine(undefined, { productId: 424242, quantity: 1, options: {} });
    expect(line.issues.map((i) => i.code)).toEqual(['unknown_product']);
    expect(line.lineTotal.amount).toBe(0);
  });

  it('a variation id that disappeared is "choose again", not a wrong price', () => {
    const tag = baseline.products.find((p) => p.id === 102)!;
    const line = priceLine(tag, {
      productId: 102,
      variationId: 999999,
      quantity: 1,
      attributes: {},
      options: {},
    });
    expect(line.issues.map((i) => i.code)).toEqual(['invalid_variation']);
  });
});
