import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CartLineIntentSchema, ProductSchema, priceLine, type Product } from '../src';

/**
 * Shared test vectors for resolving ONE cart line (ADR-014): variation lookup including WooCommerce "Any" attributes,
 * stock and quantity rules, personalization, and pricing. `kcpw-core` (PHP) must reproduce every expected result in
 * test/vectors/lines.json: same issue codes in the same order, same variation, same prices in cents, same option summary.
 * The TypeScript reference (`priceLine`) is the oracle; in production WooCommerce decides, and this file is how we prove the
 * PHP side agrees with the storefront's own display logic.
 *
 * To change behavior deliberately: edit the reference, run `UPDATE_VECTORS=1 npx vitest run test/line-vectors.test.ts`,
 * review the diff of lines.json by eye, and update the PHP side in the same change.
 */

const usd = (amount: number) => ({ amount, currency: 'USD' });
const img = { id: 1, url: '/x.svg', alt: 'x', width: 800, height: 800 };

const baseFields = {
  descriptionHtml: '<p>d</p>',
  shortDescription: 'd',
  images: [img],
  categories: [],
  seo: { title: 't', description: 'd' },
  updatedAt: '2026-10-14T00:00:00Z',
};

const nameField = { id: 'name', type: 'text', label: 'Name', required: true, maxLength: 12 };
const giftField = {
  id: 'gift',
  type: 'checkbox',
  label: 'Gift wrap',
  priceEffect: { kind: 'flat', amount: 400 },
};
const finishField = {
  id: 'finish',
  type: 'radio',
  label: 'Finish',
  choices: [
    { value: 'matte', label: 'Matte' },
    { value: 'foil', label: 'Foil', priceEffect: { kind: 'percent', basisPoints: 1000 } },
  ],
};

const products: Record<string, Product> = {
  plain: ProductSchema.parse({
    ...baseFields,
    id: 10,
    slug: 'plain',
    type: 'simple',
    name: 'Plain Case',
    price: usd(1324),
    attributes: [],
    variations: [],
    optionSchema: { version: 1, fields: [] },
    availability: { purchasable: true, stockStatus: 'instock', madeToOrder: false },
  }),
  personalized: ProductSchema.parse({
    ...baseFields,
    id: 11,
    slug: 'personalized',
    type: 'simple',
    name: 'Name Tag',
    price: usd(899),
    attributes: [],
    variations: [],
    optionSchema: { version: 1, fields: [nameField, giftField, finishField] },
    availability: { purchasable: true, stockStatus: 'instock', madeToOrder: true },
  }),
  limited: ProductSchema.parse({
    ...baseFields,
    id: 12,
    slug: 'limited',
    type: 'simple',
    name: 'Limited Run',
    price: usd(2000),
    attributes: [],
    variations: [],
    optionSchema: { version: 1, fields: [] },
    availability: {
      purchasable: true,
      stockStatus: 'instock',
      stockQuantity: 3,
      madeToOrder: false,
    },
  }),
  soldout: ProductSchema.parse({
    ...baseFields,
    id: 13,
    slug: 'soldout',
    type: 'simple',
    name: 'Sold Out Stand',
    price: usd(2000),
    attributes: [],
    variations: [],
    optionSchema: { version: 1, fields: [] },
    availability: { purchasable: true, stockStatus: 'outofstock', madeToOrder: false },
  }),
  hidden: ProductSchema.parse({
    ...baseFields,
    id: 14,
    slug: 'hidden',
    type: 'simple',
    name: 'Not For Sale',
    price: usd(500),
    attributes: [],
    variations: [],
    optionSchema: { version: 1, fields: [] },
    availability: { purchasable: false, stockStatus: 'instock', madeToOrder: false },
  }),
  // Fixed variations: every attribute has a value.
  fixed: ProductSchema.parse({
    ...baseFields,
    id: 20,
    slug: 'fixed',
    type: 'variable',
    name: 'Card Box',
    price: usd(1250),
    attributes: [
      {
        slug: 'color',
        name: 'Color',
        usedForVariations: true,
        options: [
          { slug: 'red', name: 'Red' },
          { slug: 'blue', name: 'Blue' },
          { slug: 'green', name: 'Green' },
        ],
      },
    ],
    variations: [
      { id: 201, attributes: { color: 'red' }, price: usd(1250), stockStatus: 'instock' },
      { id: 202, attributes: { color: 'blue' }, price: usd(1250), stockStatus: 'outofstock' },
      {
        id: 203,
        attributes: { color: 'green' },
        price: usd(1400),
        stockStatus: 'instock',
        stockQuantity: 2,
      },
    ],
    optionSchema: { version: 1, fields: [finishField] },
    availability: { purchasable: true, stockStatus: 'instock', madeToOrder: false },
  }),
  // The real catalog's shape: every variation is "Any" for both attributes.
  anyBoth: ProductSchema.parse({
    ...baseFields,
    id: 30,
    slug: 'any-both',
    type: 'variable',
    name: 'Bag Tag',
    price: usd(1200),
    attributes: [
      {
        slug: 'tag-color',
        name: 'Tag Color',
        usedForVariations: true,
        options: [
          { slug: 'black', name: 'Black' },
          { slug: 'navy', name: 'Navy' },
        ],
      },
      {
        slug: 'text-color',
        name: 'Text Color',
        usedForVariations: true,
        options: [
          { slug: 'white', name: 'White' },
          { slug: 'red', name: 'Red' },
        ],
      },
      {
        slug: 'material',
        name: 'Material',
        usedForVariations: false,
        options: [{ slug: 'pla', name: 'PLA' }],
      },
    ],
    variations: [
      {
        id: 301,
        attributes: { 'tag-color': '', 'text-color': '' },
        price: usd(1200),
        stockStatus: 'instock',
      },
    ],
    optionSchema: { version: 1, fields: [nameField] },
    availability: { purchasable: true, stockStatus: 'instock', madeToOrder: true },
  }),
  // A specific variation beside an "Any" fallback: the more specific one wins when both match.
  mixed: ProductSchema.parse({
    ...baseFields,
    id: 40,
    slug: 'mixed',
    type: 'variable',
    name: 'Stand',
    price: usd(1000),
    attributes: [
      {
        slug: 'size',
        name: 'Size',
        usedForVariations: true,
        options: [
          { slug: 'small', name: 'Small' },
          { slug: 'large', name: 'Large' },
        ],
      },
    ],
    variations: [
      { id: 401, attributes: { size: '' }, price: usd(1000), stockStatus: 'instock' },
      { id: 402, attributes: { size: 'large' }, price: usd(1800), stockStatus: 'instock' },
    ],
    optionSchema: { version: 1, fields: [] },
    availability: { purchasable: true, stockStatus: 'instock', madeToOrder: false },
  }),
  backorder: ProductSchema.parse({
    ...baseFields,
    id: 50,
    slug: 'backorder',
    type: 'simple',
    name: 'On Backorder',
    price: usd(700),
    attributes: [],
    variations: [],
    optionSchema: { version: 1, fields: [] },
    availability: {
      purchasable: true,
      stockStatus: 'onbackorder',
      stockQuantity: 0,
      madeToOrder: false,
    },
  }),
};

interface CaseInput {
  name: string;
  product: keyof typeof products | 'missing';
  intent: unknown;
}

const cases: CaseInput[] = [
  { name: 'plain simple product', product: 'plain', intent: { productId: 10, quantity: 2 } },
  {
    name: 'simple product rejects a variation id',
    product: 'plain',
    intent: { productId: 10, variationId: 5, quantity: 1 },
  },
  {
    name: 'simple product rejects attributes',
    product: 'plain',
    intent: { productId: 10, quantity: 1, attributes: { color: 'red' } },
  },
  { name: 'unknown product', product: 'missing', intent: { productId: 999, quantity: 1 } },
  { name: 'not purchasable', product: 'hidden', intent: { productId: 14, quantity: 1 } },
  { name: 'out of stock', product: 'soldout', intent: { productId: 13, quantity: 1 } },
  { name: 'within stock limit', product: 'limited', intent: { productId: 12, quantity: 3 } },
  { name: 'over stock limit', product: 'limited', intent: { productId: 12, quantity: 4 } },
  {
    name: 'backorder is not limited',
    product: 'backorder',
    intent: { productId: 50, quantity: 20 },
  },
  {
    name: 'personalized: valid with flat and percent charges',
    product: 'personalized',
    intent: { productId: 11, quantity: 2, options: { name: 'Robin', gift: true, finish: 'foil' } },
  },
  {
    name: 'personalized: required name missing',
    product: 'personalized',
    intent: { productId: 11, quantity: 1, options: {} },
  },
  {
    name: 'personalized: unknown option field',
    product: 'personalized',
    intent: { productId: 11, quantity: 1, options: { name: 'Robin', engraving: 'x' } },
  },
  {
    name: 'personalized: bad choice and too long text',
    product: 'personalized',
    intent: {
      productId: 11,
      quantity: 1,
      options: { name: 'A very long name indeed', finish: 'glitter' },
    },
  },
  {
    name: 'options on a product without a schema',
    product: 'plain',
    intent: { productId: 10, quantity: 1, options: { name: 'Robin' } },
  },
  {
    name: 'fixed variation: id alone fills in the value',
    product: 'fixed',
    intent: { productId: 20, variationId: 201, quantity: 1 },
  },
  {
    name: 'fixed variation: matching chosen attribute',
    product: 'fixed',
    intent: { productId: 20, variationId: 203, quantity: 1, attributes: { color: 'green' } },
  },
  {
    name: 'fixed variation: chosen attribute disagrees',
    product: 'fixed',
    intent: { productId: 20, variationId: 201, quantity: 1, attributes: { color: 'blue' } },
  },
  {
    name: 'fixed variation: variation out of stock',
    product: 'fixed',
    intent: { productId: 20, variationId: 202, quantity: 1 },
  },
  {
    name: 'fixed variation: over its own stock limit',
    product: 'fixed',
    intent: { productId: 20, variationId: 203, quantity: 3 },
  },
  {
    name: 'variable: variation id missing',
    product: 'fixed',
    intent: { productId: 20, quantity: 1 },
  },
  {
    name: 'variable: variation id from another product',
    product: 'fixed',
    intent: { productId: 20, variationId: 301, quantity: 1 },
  },
  {
    name: 'variable: unknown attribute slug',
    product: 'fixed',
    intent: { productId: 20, variationId: 201, quantity: 1, attributes: { size: 'big' } },
  },
  {
    name: 'any variation: both attributes chosen',
    product: 'anyBoth',
    intent: {
      productId: 30,
      variationId: 301,
      quantity: 1,
      attributes: { 'tag-color': 'navy', 'text-color': 'red' },
      options: { name: 'Robin' },
    },
  },
  {
    name: 'any variation: attributes not chosen',
    product: 'anyBoth',
    intent: { productId: 30, variationId: 301, quantity: 1, options: { name: 'Robin' } },
  },
  {
    name: 'any variation: only one attribute chosen',
    product: 'anyBoth',
    intent: {
      productId: 30,
      variationId: 301,
      quantity: 1,
      attributes: { 'tag-color': 'navy' },
      options: { name: 'Robin' },
    },
  },
  {
    name: 'any variation: chosen option does not exist',
    product: 'anyBoth',
    intent: {
      productId: 30,
      variationId: 301,
      quantity: 1,
      attributes: { 'tag-color': 'neon', 'text-color': 'red' },
      options: { name: 'Robin' },
    },
  },
  {
    name: 'any variation: attribute that does not select variations',
    product: 'anyBoth',
    intent: {
      productId: 30,
      variationId: 301,
      quantity: 1,
      attributes: { 'tag-color': 'navy', 'text-color': 'red', material: 'pla' },
      options: { name: 'Robin' },
    },
  },
  {
    name: 'mixed: the Any fallback variation with a chosen size',
    product: 'mixed',
    intent: { productId: 40, variationId: 401, quantity: 1, attributes: { size: 'small' } },
  },
  {
    name: 'mixed: the specific variation',
    product: 'mixed',
    intent: { productId: 40, variationId: 402, quantity: 1, attributes: { size: 'large' } },
  },
  {
    name: 'fixed variation with product-level option charge (percent of the variation price)',
    product: 'fixed',
    intent: { productId: 20, variationId: 203, quantity: 2, options: { finish: 'foil' } },
  },
];

function expectedFor(c: CaseInput) {
  const product = c.product === 'missing' ? undefined : products[c.product];
  const intent = CartLineIntentSchema.parse(c.intent);
  const line = priceLine(product, intent);
  return {
    issues: line.issues.map((i) => ({ code: i.code, ...(i.field ? { field: i.field } : {}) })),
    variationId: line.variationId ?? null,
    variationLabel: line.variationLabel ?? null,
    unitPrice: line.unitPrice.amount,
    optionAdders: line.optionAdders.amount,
    lineTotal: line.lineTotal.amount,
    summary: line.optionSummary.map((s) => [s.fieldId, s.value]),
  };
}

const file = resolve(__dirname, 'vectors/lines.json');
const generated = {
  version: 1,
  note: 'Generated by test/line-vectors.test.ts from the TypeScript reference (priceLine). kcpw-core (PHP) must reproduce every expected result.',
  products,
  cases: cases.map((c) => ({
    name: c.name,
    product: c.product,
    intent: c.intent,
    expected: expectedFor(c),
  })),
};

describe('shared line vectors', () => {
  it('lines.json matches what the reference produces (run with UPDATE_VECTORS=1 to regenerate)', () => {
    if (process.env.UPDATE_VECTORS) {
      writeFileSync(file, JSON.stringify(generated, null, 2) + '\n');
    }
    const onDisk = JSON.parse(readFileSync(file, 'utf8'));
    expect(onDisk).toEqual(JSON.parse(JSON.stringify(generated)));
  });

  it('covers the cases that matter for the real catalog', () => {
    const codes = new Set(generated.cases.flatMap((c) => c.expected.issues.map((i) => i.code)));
    for (const code of [
      'unknown_product',
      'unavailable',
      'invalid_variation',
      'out_of_stock',
      'quantity_limit',
      'invalid_option',
    ]) {
      expect(codes.has(code as never)).toBe(true);
    }
    expect(generated.cases.length).toBeGreaterThanOrEqual(25);
  });
});
