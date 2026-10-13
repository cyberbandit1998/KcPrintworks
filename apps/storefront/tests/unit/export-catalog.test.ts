import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ProductSchema, priceLine } from '@kcpw/contracts';
import { convertExport } from '@/lib/catalog/export/convert';
import { parseCsv, readExport } from '@/lib/catalog/export/csv';
import { descriptionHtml, sanitizeTitle, toMinorUnits } from '@/lib/catalog/export/text';

// Invented rows that reproduce the quirks of a real WooCommerce export (see docs/discovery/INVENTORY.md).
const HEADER = [
  'ID',
  'Type',
  'SKU',
  'Name',
  'Published',
  'Is featured?',
  'Visibility in catalog',
  'Short description',
  'Description',
  'In stock?',
  'Sale price',
  'Regular price',
  'Categories',
  'Images',
  'Parent',
  'Position',
  'Attribute 1 name',
  'Attribute 1 value(s)',
  'Attribute 2 name',
  'Attribute 2 value(s)',
  'Attribute 3 name',
  'Attribute 3 value(s)',
];
const row = (cells: Record<string, string>) =>
  HEADER.map((h) => `"${(cells[h] ?? '').replace(/"/g, '""')}"`).join(',');
const csv = [
  HEADER.join(','),
  row({
    ID: '1',
    Type: 'simple',
    SKU: 'CASE-1',
    Name: 'Skip-Bo &amp; Friends Case',
    Published: '1',
    'Is featured?': '1',
    'Visibility in catalog': 'visible',
    Description:
      'Line one.\\n\\nLine two with a break.\\nSecond line.<br>Listed with ExportYourStore.com',
    'In stock?': '1',
    'Regular price': '13.24',
    'Sale price': '9.9',
    Categories: 'Uncategorized',
    Images: 'https://example.com/a.jpg, https://example.com/b.jpg',
    'Attribute 1 name': 'Condition',
    'Attribute 1 value(s)': 'made_to_order',
    'Attribute 2 name': 'MPN',
    'Attribute 2 value(s)': 'abc',
  }),
  row({
    ID: '2',
    Type: 'variable',
    SKU: 'TAG-PARENT',
    Name: 'Personalized Bag Tag, Custom Name',
    Published: '1',
    'Visibility in catalog': 'visible',
    'In stock?': '1',
    Categories: 'Gifts',
    'Attribute 1 name': 'Tag Color',
    'Attribute 1 value(s)': 'Black, Hot Pink, Navy',
    'Attribute 2 name': 'Text Color',
    'Attribute 2 value(s)': 'White, Black',
    'Attribute 3 name': 'Condition',
    'Attribute 3 value(s)': 'made_to_order',
  }),
  row({
    ID: '21',
    Type: 'variation',
    SKU: 'TAG-1',
    Name: 'Personalized Bag Tag',
    Published: '1',
    'In stock?': '1',
    'Regular price': '8.99',
    Parent: 'TAG-PARENT',
    'Attribute 1 name': 'Tag Color',
    'Attribute 1 value(s)': '',
    'Attribute 2 name': 'Text Color',
    'Attribute 2 value(s)': '',
  }),
  row({
    ID: '22',
    Type: 'variation',
    SKU: 'TAG-2',
    Name: 'Personalized Bag Tag',
    Published: '1',
    'In stock?': '0',
    'Regular price': '8.99',
    Parent: 'id:2',
    'Attribute 1 name': 'Tag Color',
    'Attribute 1 value(s)': 'Navy',
    'Attribute 2 name': 'Text Color',
    'Attribute 2 value(s)': '',
  }),
  row({
    ID: '3',
    Type: 'variable',
    SKU: 'EMPTY',
    Name: 'Variable with nothing buyable',
    Published: '1',
    'Visibility in catalog': 'visible',
    Categories: 'Gifts',
  }),
  row({ ID: '4', Type: 'simple', Name: 'A draft', Published: '0', 'Regular price': '1' }),
  row({
    ID: '5',
    Type: 'simple',
    Name: 'Skip-Bo &amp; Friends Case',
    Published: '1',
    'Visibility in catalog': 'visible',
    'In stock?': '1',
    'Regular price': '14',
    Categories: 'Gifts',
  }),
  row({
    ID: '6',
    Type: 'simple',
    Name: 'Hidden one',
    Published: '1',
    'Visibility in catalog': 'hidden',
    'Regular price': '5',
  }),
].join('\r\n');

const convert = (overrides = {}) =>
  convertExport(readExport(csv), {
    categories: 'current',
    now: new Date('2026-10-13T12:00:00Z'),
    ...overrides,
  });

describe('csv reader', () => {
  it('handles quotes, embedded newlines, CRLF, a BOM, and short rows', () => {
    const rows = parseCsv('﻿a,b\r\n"x,1","line\nbreak"\r\nshort\r\n');
    expect(rows).toEqual([['a', 'b'], ['x,1', 'line\nbreak'], ['short']]);
    expect(readExport('a,b,c\r\n1\r\n')).toEqual([{ a: '1', b: '', c: '' }]);
  });
});

describe('text helpers', () => {
  it('turns decimal strings into integer cents without floats', () => {
    expect(toMinorUnits('13.24')).toBe(1324);
    expect(toMinorUnits('9.9')).toBe(990);
    expect(toMinorUnits('7')).toBe(700);
    expect(toMinorUnits('')).toBeUndefined();
    expect(toMinorUnits('free')).toBeUndefined();
    expect(toMinorUnits('0.1')).toBe(10);
  });
  it('builds WordPress-style slugs', () => {
    expect(sanitizeTitle('Skip-Bo &amp; Friends: 3D Printed | Case!')).toBe(
      'skip-bo-and-friends-3d-printed-case',
    );
  });
  it('applies paragraphs to plain export text and drops a trailing import footer from display', () => {
    const html = descriptionHtml(
      'Line one.\\n\\nLine two.\\nSecond.<br>Listed with ExportYourStore.com',
    );
    expect(html).toBe('<p>Line one.</p>\n<p>Line two.<br>Second.</p>');
    expect(html).not.toContain('ExportYourStore');
    expect(descriptionHtml('<p>Already HTML</p>')).toBe('<p>Already HTML</p>');
  });
  it('turns bullet lines, numbered lines, and ALL-CAPS lines into lists and headings', () => {
    const html = descriptionHtml(
      'Intro line.\\nCUSTOMIZE YOUR TAG\\n\u2022 Name\\n\u2022 Icon\\nHOW TO ORDER\\n1. Pick a color\\n2. Type a name\\nDesigned & printed.',
    );
    expect(html).toBe(
      '<p>Intro line.</p>\n<h3>Customize your tag</h3>\n<ul><li>Name</li><li>Icon</li></ul>\n<h3>How to order</h3>\n<ol><li>Pick a color</li><li>Type a name</li></ol>\n<p>Designed & printed.</p>',
    );
  });
  it('does not mistake sentences or short capitals for headings', () => {
    expect(descriptionHtml('USB cable.\\nGreat for kids!')).toBe(
      '<p>USB cable.<br>Great for kids!</p>',
    );
    expect(descriptionHtml('PLA')).toBe('<p>PLA</p>');
  });
});

describe('convertExport', () => {
  const { products, skipped, notes } = convert();
  const byId = (id: number) => products.find((p) => p.id === id)!;

  it('produces only products that satisfy the storefront contract', () => {
    for (const p of products) expect(ProductSchema.safeParse(p).success).toBe(true);
    expect(products.map((p) => p.id)).toEqual([1, 2, 5]);
  });

  it('says what it left out and why', () => {
    expect(skipped.map((s) => [s.id, s.reason.split(':')[0]])).toEqual([
      ['3', 'variable product with no usable variations in the export'],
      ['6', 'hidden from the catalog in WooCommerce'],
    ]);
    expect(notes.join(' ')).toMatch(/DERIVED/);
  });

  it('keeps real values: decoded title, price, sale price, made-to-order, photos', () => {
    const p = byId(1);
    expect(p.name).toBe('Skip-Bo & Friends Case');
    expect(p.price.amount).toBe(990);
    expect(p.regularPrice?.amount).toBe(1324);
    expect(p.availability.madeToOrder).toBe(true);
    expect(p.images.map((i) => i.url)).toEqual([
      'https://example.com/a.jpg',
      'https://example.com/b.jpg',
    ]);
    expect(p.descriptionHtml).not.toContain('ExportYourStore');
  });

  it('hides marketplace attributes from display and keeps shopper-facing ones', () => {
    expect(byId(1).attributes).toEqual([]);
    expect(byId(2).attributes.map((a) => a.name)).toEqual(['Tag Color', 'Text Color']);
  });

  it('keeps blank variation values as "Any" and never invents a specific option', () => {
    const tag = byId(2);
    expect(tag.variations).toHaveLength(2);
    expect(tag.variations[0]!.attributes).toEqual({ 'tag-color': '', 'text-color': '' });
    expect(tag.variations[1]!.attributes).toEqual({ 'tag-color': 'navy', 'text-color': '' });
    expect(tag.attributes[0]!.options.map((o) => o.slug)).toEqual(['black', 'hot-pink', 'navy']);
    expect(tag.price.amount).toBe(899);
  });

  it('resolves the parent of a variation by SKU or by id:<n>', () => {
    expect(byId(2).variations.map((v) => v.id)).toEqual([21, 22]);
  });

  it('gives duplicate titles distinct, stable URLs', () => {
    expect(byId(1).slug).toBe('skip-bo-and-friends-case');
    expect(byId(5).slug).toBe('skip-bo-and-friends-case-5');
  });

  it('proposes personalization fields only for products that say they are personalized', () => {
    expect(byId(1).optionSchema.fields).toEqual([]);
    expect(byId(2).optionSchema.fields.map((f) => f.id)).toEqual(['name', 'icon', 'cable_color']);
  });

  it('a proposed bag tag line prices through the same reference logic as the real thing', () => {
    const tag = byId(2);
    const quote = priceLine(tag, {
      productId: 2,
      variationId: 21,
      attributes: { 'tag-color': 'hot-pink', 'text-color': 'white' },
      quantity: 1,
      options: { name: 'Robin', cable_color: 'Black' },
    });
    expect(quote.issues).toEqual([]);
    expect(quote.unitPrice.amount).toBe(899);
  });

  it('uses the proposed category plan, then falls back to the current categories', () => {
    const plan = new Map([['1', { name: 'Card Game Cases', slug: 'card-games' }]]);
    const proposed = convert({ categories: 'proposed', categoryPlan: plan });
    expect(proposed.products.find((p) => p.id === 1)!.categories[0]!.slug).toBe('card-games');
    expect(proposed.products.find((p) => p.id === 5)!.categories[0]!.slug).toBe('gifts');
  });

  it('can leave out retired duplicates and swap in placeholder photos', () => {
    const result = convert({ hide: new Set(['5']), placeholderImages: true });
    expect(result.products.map((p) => p.id)).toEqual([1, 2]);
    expect(result.products[0]!.images.every((i) => i.url.startsWith('/fixtures/'))).toBe(true);
  });

  it('ignores an expired or future sale price', () => {
    const expired = readExport(csv).map((r) =>
      r.ID === '1' ? { ...r, 'Date sale price ends': '2026-01-01' } : r,
    );
    const result = convertExport(expired, {
      categories: 'current',
      now: new Date('2026-10-13T12:00:00Z'),
    });
    expect(result.products.find((p) => p.id === 1)!.price.amount).toBe(1324);
    expect(result.products.find((p) => p.id === 1)!.regularPrice).toBeUndefined();
  });
});

// Runs only where the owner's real export is present (it is gitignored, so never in CI).
const realExport = path.resolve(process.cwd(), '../../docs/discovery/raw/products.csv');
describe.skipIf(!existsSync(realExport))("the owner's real export", () => {
  const rows = readExport(readFileSync(realExport, 'utf8'));
  const result = convertExport(rows, { categories: 'current', placeholderImages: true });

  it('converts every published product, or says exactly why not', () => {
    const published = rows.filter(
      (r) => (r.Type === 'simple' || r.Type === 'variable') && r.Published === '1',
    );
    expect(result.products.length + result.skipped.length).toBe(published.length);
    expect(result.skipped).toEqual([]);
  });

  it('keeps unique URLs and the real price range', () => {
    expect(new Set(result.products.map((p) => p.slug)).size).toBe(result.products.length);
    const cents = result.products.map((p) => p.price.amount);
    expect(Math.min(...cents)).toBeGreaterThan(0);
    expect(Math.max(...cents)).toBeLessThan(20000);
  });
});
