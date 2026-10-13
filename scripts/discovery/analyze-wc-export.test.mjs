import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyze, decodeEntities, parseCsv, readExport } from './analyze-wc-export.mjs';

test('parseCsv handles quotes, doubled quotes, embedded newlines, CRLF, and a BOM', () => {
  const csv = '﻿a,b,c\r\n1,"he said ""hi""","line1\nline2"\r\n2,,last';
  assert.deepEqual(parseCsv(csv), [
    ['a', 'b', 'c'],
    ['1', 'he said "hi"', 'line1\nline2'],
    ['2', '', 'last'],
  ]);
});

test('decodeEntities decodes named, decimal, and hex entities and leaves unknown ones alone', () => {
  assert.equal(
    decodeEntities('Fish &amp; Chips &#8211; &#x2013; &unknown;'),
    'Fish & Chips – – &unknown;',
  );
});

test('readExport pads short rows from earlier export batches', () => {
  const { rows, widths } = readExport('ID,Type,Name\n1,simple\n2,simple,Two');
  assert.equal(rows[0].Name, '');
  assert.equal(rows[1].Name, 'Two');
  assert.equal(widths.get(2), 1);
});

const HEADER = [
  'ID',
  'Type',
  'SKU',
  'Name',
  'Published',
  'Categories',
  'Stock',
  'Regular price',
  'Sale price',
  'Description',
  'Short description',
  'Images',
  'Parent',
  'Weight (lbs)',
  'Tax status',
  'In stock?',
  'Attribute 1 name',
  'Attribute 1 value(s)',
  'Attribute 1 visible',
  'Meta: fb_mpn',
];
const row = (o) =>
  HEADER.map((h) => o[h] ?? '')
    .map((v) => `"${String(v).replace(/"/g, '""')}"`)
    .join(',');
const csv = [
  HEADER.join(','),
  row({
    ID: '1',
    Type: 'variable',
    SKU: 'PARENT_!',
    Name: 'Box &amp; Lid | 3D',
    Published: '1',
    Categories: 'Uncategorized',
    'Attribute 1 name': 'Color',
    'Attribute 1 value(s)': 'Red, Blue',
    'Attribute 1 visible': '1',
  }),
  row({
    ID: '2',
    Type: 'variation',
    SKU: 'PARENT-RED',
    Parent: 'PARENT_!',
    'Regular price': '10',
    Stock: '15',
    'Attribute 1 name': 'Color',
  }),
  row({
    ID: '3',
    Type: 'variation',
    SKU: 'PARENT-BLUE',
    Parent: 'id:1',
    'Regular price': '10',
    Stock: '15',
    'Attribute 1 name': 'Color',
    'Attribute 1 value(s)': 'Blue',
  }),
  row({
    ID: '4',
    Type: 'simple',
    SKU: 'abcDEF123xy',
    Name: 'Same Title',
    Published: '1',
    Categories: 'Cards',
    'Regular price': '9',
    'Sale price': '6',
    Description: 'Make it personalized',
    'Attribute 1 name': 'Condition',
    'Attribute 1 value(s)': 'made_to_order',
    'Attribute 1 visible': '1',
  }),
  row({
    ID: '5',
    Type: 'simple',
    SKU: '31524821868_D520',
    Name: 'same  title!',
    Published: '-1',
    Categories: 'Cards',
    'Regular price': '9',
    'Weight (lbs)': '16',
  }),
].join('\n');

test('analyze reports duplicates, "Any" variations, drafts, SKU styles, and marketplace attributes', () => {
  const r = analyze(readExport(csv));
  assert.deepEqual(r.topLevel, { total: 3, simple: 2, variable: 1 });
  assert.deepEqual(r.publishState, { published: 2, draft: 1 });
  assert.equal(r.variations.total, 2);
  assert.equal(r.variations.orphans, 0);
  assert.equal(r.variations.noAttributeValueAtAll, 1); // PARENT-RED has no value; PARENT-BLUE does
  assert.equal(r.variations.perVariableProduct[0].variations, 2); // parent resolved by SKU and by "id:" form
  assert.equal(r.duplicates.groups, 1);
  assert.equal(r.duplicates.products, 2);
  assert.equal(r.uncategorizedPublished, 1);
  assert.equal(r.skus.variableParentsEndingBang, 1);
  assert.equal(r.skus.topLevelStyles['numeric-prefix'], 1);
  assert.equal(r.skus.topLevelStyles['random-looking'], 1);
  assert.deepEqual(r.attributes.marketplaceStyleAttributesShownToShoppers, ['Condition']);
  assert.equal(r.content.namesWithHtmlEntities, 1);
  assert.equal(r.prices.rowsOnSale, 1);
  assert.deepEqual(r.shipping.weightOutliersTopLevel, [{ id: '5', weight: '16' }]);
  assert.equal(r.personalization.topLevelWithSignalInTitleOrDescription[0].id, '4');
  assert.equal(r.plugins.productFieldOrAddonPluginMetaFound, false);
  assert.ok(r.plugins.fingerprints['Facebook for WooCommerce']);
});
