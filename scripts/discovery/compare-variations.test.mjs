import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compare, render } from './compare-variations.mjs';

const row = (o) => ({ ID: '', Type: '', Parent: '', SKU: '', Name: '', ...o });
const exportRows = {
  rows: [
    row({
      ID: '10',
      Type: 'variable',
      Name: 'Bag Tag',
      'Attribute 1 name': 'Tag Color',
      'Attribute 1 value(s)': 'Red, Blue',
    }),
    row({
      ID: '101',
      Type: 'variation',
      Parent: 'id:10',
      SKU: 'T-1',
      'Attribute 1 name': 'Tag Color',
      'Attribute 1 value(s)': '',
    }),
    row({
      ID: '102',
      Type: 'variation',
      Parent: 'id:10',
      SKU: 'T-2',
      'Attribute 1 name': 'Tag Color',
      'Attribute 1 value(s)': '',
    }),
    row({
      ID: '20',
      Type: 'variable',
      Name: 'Case',
      'Attribute 1 name': 'Size',
      'Attribute 1 value(s)': 'Small, Large',
    }),
    row({
      ID: '201',
      Type: 'variation',
      Parent: 'id:20',
      'Attribute 1 name': 'Size',
      'Attribute 1 value(s)': 'Small',
    }),
    row({ ID: '30', Type: 'variable', Name: 'Not live' }),
  ],
};

test('blank in both places is a genuine "Any"; missing attribute on the live side counts too', () => {
  const live = [
    {
      id: 10,
      variation_details: [
        { id: 101, attributes: [{ name: 'Tag Color', option: '' }] },
        { id: 102, attributes: [] },
      ],
    },
    { id: 20, variation_details: [{ id: 201, attributes: [{ name: 'Size', option: 'small' }] }] },
  ];
  const { totals, products } = compare(exportRows, live);
  assert.equal(totals.anyConfirmed, 2);
  assert.equal(totals.valuesAgree, 1); // "Small" vs "small"
  assert.equal(totals.exportBlankLiveHasValue, 0);
  assert.equal(products.find((p) => p.id === '30').status, 'not in live snapshot');
  assert.match(render({ products, totals }), /The blanks are confirmed/);
});

test('a blank in the export where the live store has a value is reported as lost data, never as "Any"', () => {
  const live = [
    {
      id: 10,
      variation_details: [
        { id: 101, attributes: [{ name: 'Tag Color', option: 'Red' }] },
        { id: 102, attributes: [{ name: 'Tag Color', option: '' }] },
      ],
    },
  ];
  const { totals, products } = compare(exportRows, live);
  assert.equal(totals.exportBlankLiveHasValue, 1);
  const finding = products.find((p) => p.id === '10').findings[0];
  assert.deepEqual(
    [finding.kind, finding.attribute, finding.live],
    ['export-blank-live-has-value', 'Tag Color', 'Red'],
  );
  assert.match(render({ products, totals }), /NOT all confirmed/);
});

test('differing values, and variations present on only one side, are all surfaced', () => {
  const live = [
    {
      id: 20,
      variation_details: [
        { id: 201, attributes: [{ name: 'Size', option: 'Large' }] },
        { id: 299, attributes: [{ name: 'Size', option: 'Small' }] },
      ],
    },
    { id: 10, variation_details: [{ id: 101, attributes: [] }] },
  ];
  const { totals } = compare(exportRows, live);
  assert.equal(totals.valuesDisagree, 1);
  assert.equal(totals.missingFromExport, 1);
  assert.equal(totals.missingFromLive, 1); // variation 102 is not live
});

test('a snapshot without variation detail never claims the blanks are confirmed', () => {
  const { totals, products } = compare(exportRows, [{ id: 10 }, { id: 20 }]);
  assert.equal(totals.anyConfirmed, 0);
  assert.doesNotMatch(render({ products, totals }), /The blanks are confirmed/);
});
