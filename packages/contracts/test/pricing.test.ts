import { describe, expect, it } from 'vitest';
import {
  CartLineIntentSchema,
  QuoteRequestSchema,
  ProductSchema,
  findVariation,
  lineKey,
  money,
  priceLine,
  priceRange,
  type Product,
} from '../src';

const img = { id: 1, url: '/x.svg', alt: 'x', width: 800, height: 800 };

function baseProduct(overrides: Partial<Product> = {}): Product {
  return ProductSchema.parse({
    id: 10,
    slug: 'sample-print',
    type: 'simple',
    name: 'Sample Print',
    descriptionHtml: '<p>d</p>',
    shortDescription: 'd',
    price: money(2400),
    images: [img],
    categories: [],
    attributes: [],
    variations: [],
    optionSchema: {
      version: 1,
      fields: [
        { id: 'name', type: 'text', label: 'Name', required: true, maxLength: 12 },
        {
          id: 'gift',
          type: 'checkbox',
          label: 'Gift wrap',
          priceEffect: { kind: 'flat', amount: 400 },
        },
        {
          id: 'finish',
          type: 'radio',
          label: 'Finish',
          choices: [
            { value: 'matte', label: 'Matte' },
            { value: 'foil', label: 'Foil', priceEffect: { kind: 'percent', basisPoints: 1000 } },
          ],
        },
      ],
    },
    availability: { purchasable: true, stockStatus: 'instock', madeToOrder: true, leadTimeDays: 5 },
    seo: { title: 't', description: 'd' },
    updatedAt: '2026-10-13T00:00:00Z',
    ...overrides,
  });
}

function variableProduct(): Product {
  return ProductSchema.parse({
    ...baseProduct(),
    id: 20,
    slug: 'sample-poster',
    type: 'variable',
    attributes: [
      {
        slug: 'size',
        name: 'Size',
        usedForVariations: true,
        options: [
          { slug: 's', name: 'Small' },
          { slug: 'l', name: 'Large' },
        ],
      },
    ],
    variations: [
      { id: 201, attributes: { size: 's' }, price: money(1800), stockStatus: 'instock' },
      { id: 202, attributes: { size: 'l' }, price: money(3200), stockStatus: 'outofstock' },
    ],
    price: money(1800),
    availability: { purchasable: true, stockStatus: 'instock', madeToOrder: false },
  });
}

describe('priceLine', () => {
  it('prices a valid simple product with options', () => {
    const q = priceLine(baseProduct(), {
      productId: 10,
      quantity: 2,
      options: { name: 'Ada', gift: true, finish: 'foil' },
    });
    expect(q.issues).toEqual([]);
    // $24.00 + 10% foil ($2.40) + $4.00 gift = $30.40 each, x2
    expect(q.optionAdders.amount).toBe(240 + 400);
    expect(q.unitPrice.amount).toBe(3040);
    expect(q.lineTotal.amount).toBe(6080);
    expect(q.optionSummary.map((s) => s.label)).toEqual(['Name', 'Gift wrap', 'Finish']);
  });

  it('reports invalid options as issues and does not price adders from invalid input', () => {
    const q = priceLine(baseProduct(), { productId: 10, quantity: 1, options: { gift: true } });
    expect(q.issues).toEqual([expect.objectContaining({ code: 'invalid_option', field: 'name' })]);
    expect(q.optionAdders.amount).toBe(0);
  });

  it('flags an unknown product', () => {
    const q = priceLine(undefined, { productId: 999, quantity: 1, options: {} });
    expect(q.issues[0]?.code).toBe('unknown_product');
  });

  it('requires a valid variation for variable products', () => {
    const p = variableProduct();
    expect(
      priceLine(p, { productId: 20, quantity: 1, options: { name: 'A' } }).issues[0]?.code,
    ).toBe('invalid_variation');
    expect(
      priceLine(p, { productId: 20, variationId: 999, quantity: 1, options: { name: 'A' } })
        .issues[0]?.code,
    ).toBe('invalid_variation');
  });

  it('uses the variation price and label', () => {
    const q = priceLine(variableProduct(), {
      productId: 20,
      variationId: 201,
      quantity: 1,
      options: { name: 'Ada' },
    });
    expect(q.issues).toEqual([]);
    expect(q.unitPrice.amount).toBe(1800);
    expect(q.variationLabel).toBe('Size: Small');
  });

  it('flags out-of-stock variations', () => {
    const q = priceLine(variableProduct(), {
      productId: 20,
      variationId: 202,
      quantity: 1,
      options: { name: 'Ada' },
    });
    expect(q.issues.map((i) => i.code)).toContain('out_of_stock');
  });

  it('rejects a variationId on a simple product', () => {
    const q = priceLine(baseProduct(), {
      productId: 10,
      variationId: 5,
      quantity: 1,
      options: { name: 'Ada' },
    });
    expect(q.issues.map((i) => i.code)).toContain('invalid_variation');
  });

  it('enforces managed stock limits unless made to order', () => {
    const limited = baseProduct({
      availability: {
        purchasable: true,
        stockStatus: 'instock',
        stockQuantity: 3,
        madeToOrder: false,
      },
    });
    expect(
      priceLine(limited, { productId: 10, quantity: 4, options: { name: 'A' } }).issues.map(
        (i) => i.code,
      ),
    ).toContain('quantity_limit');
    const mto = baseProduct({
      availability: {
        purchasable: true,
        stockStatus: 'instock',
        stockQuantity: 3,
        madeToOrder: true,
      },
    });
    expect(priceLine(mto, { productId: 10, quantity: 4, options: { name: 'A' } }).issues).toEqual(
      [],
    );
  });

  it('flags non-purchasable products', () => {
    const p = baseProduct({
      availability: { purchasable: false, stockStatus: 'instock', madeToOrder: true },
    });
    expect(
      priceLine(p, { productId: 10, quantity: 1, options: { name: 'A' } }).issues[0]?.code,
    ).toBe('unavailable');
  });
});

describe('variations and ranges', () => {
  it('finds a variation by attribute selection', () => {
    const p = variableProduct();
    expect(findVariation(p, { size: 'l' })?.id).toBe(202);
    expect(findVariation(p, {})).toBeUndefined();
    expect(findVariation(p, { size: 'xl' })).toBeUndefined();
  });

  it('reports the price range across variations', () => {
    const r = priceRange(variableProduct());
    expect([r.min.amount, r.max.amount]).toEqual([1800, 3200]);
  });
});

describe('cart contract', () => {
  it('rejects client-supplied prices and other unexpected fields', () => {
    for (const extra of [
      { price: 1 },
      { total: 0 },
      { unitPrice: { amount: 1, currency: 'USD' } },
    ]) {
      expect(
        CartLineIntentSchema.safeParse({ productId: 1, quantity: 1, options: {}, ...extra })
          .success,
      ).toBe(false);
    }
    expect(QuoteRequestSchema.safeParse({ lines: [], discountTotal: 100 }).success).toBe(false);
  });

  it('bounds quantity', () => {
    expect(CartLineIntentSchema.safeParse({ productId: 1, quantity: 0 }).success).toBe(false);
    expect(CartLineIntentSchema.safeParse({ productId: 1, quantity: 100 }).success).toBe(false);
    expect(CartLineIntentSchema.safeParse({ productId: 1, quantity: 1.5 }).success).toBe(false);
    expect(CartLineIntentSchema.safeParse({ productId: 1, quantity: 99 }).success).toBe(true);
  });

  it('keys lines so identical choices merge and different personalization never does', () => {
    const a = lineKey({ productId: 1, options: { name: 'Ada', gift: true } });
    const same = lineKey({ productId: 1, options: { gift: true, name: 'Ada' } });
    const other = lineKey({ productId: 1, options: { name: 'Bea', gift: true } });
    const ignoresEmpty = lineKey({
      productId: 1,
      options: { name: 'Ada', gift: true, note: '', x: false },
    });
    expect(a).toBe(same);
    expect(a).not.toBe(other);
    expect(a).toBe(ignoresEmpty);
    expect(lineKey({ productId: 1, variationId: 2, options: {} })).not.toBe(
      lineKey({ productId: 1, variationId: 3, options: {} }),
    );
  });
});

describe('product schema', () => {
  it('rejects unexpected fields such as Etsy data', () => {
    const base = baseProduct();
    expect(ProductSchema.safeParse({ ...base, etsyListingId: 123 }).success).toBe(false);
    expect(ProductSchema.safeParse({ ...base, etsyPrice: money(1) }).success).toBe(false);
  });

  it('rejects variable products whose variations do not cover the variation attributes', () => {
    const bad = {
      ...variableProduct(),
      variations: [{ id: 1, attributes: {}, price: money(100), stockStatus: 'instock' }],
    };
    expect(ProductSchema.safeParse(bad).success).toBe(false);
  });
});
