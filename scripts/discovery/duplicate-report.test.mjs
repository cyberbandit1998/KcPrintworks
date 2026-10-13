import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readExport } from './analyze-wc-export.mjs';
import {
  buildGroups,
  plainText,
  recommend,
  render,
  similarity,
  toCsv,
} from './duplicate-report.mjs';

const HEADER = [
  'ID',
  'Type',
  'SKU',
  'Name',
  'Published',
  'Categories',
  'Tags',
  'Stock',
  'Regular price',
  'Sale price',
  'Description',
  'Images',
  'Parent',
  'Attribute 1 name',
  'Attribute 1 value(s)',
];
const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
const row = (o) => HEADER.map((h) => q(o[h] ?? '')).join(',');
const TEXT =
  'Keeps your batteries organized and protected. Fits AAA cells and stacks neatly in a drawer.';
const csv = (...rows) => [HEADER.join(','), ...rows.map(row)].join('\n');

const OLD = {
  ID: '10',
  Type: 'simple',
  SKU: 'abcDEF123xy',
  Name: 'AAA Box &amp; Case',
  Published: '1',
  Categories: 'HomeGoods',
  Tags: 'a,b,c,d,e,f',
  'Regular price': '11.59',
  'Sale price': '9.99',
  Description: TEXT,
  Images: 'https://x/2026/05/aaa.jpg',
};
const NEW = {
  ID: '90',
  Type: 'simple',
  SKU: '29694849018_D622',
  Name: 'AAA Box & Case',
  Published: '1',
  Categories: 'Uncategorized',
  Tags: '',
  'Regular price': '11.59',
  Description: `${TEXT}<br><br>Listed with ExportYourStore.com`,
  Images: 'https://x/2026/09/il_fullxfull.1.jpg',
  'Attribute 1 name': 'Condition',
  'Attribute 1 value(s)': 'made_to_order',
};

test('plainText removes the import footer, markup, and layout differences', () => {
  assert.equal(plainText('A  b\\nC<br><br>Listed with ExportYourStore.com'), 'a b c');
  assert.equal(plainText('<p>Fish &amp; Chips</p>'), 'fish & chips');
});

test('similarity is 1 for the same text and low for different text', () => {
  assert.equal(similarity('one two three four', 'one two three four'), 1);
  assert.ok(similarity('one two three four five', 'six seven eight nine ten') < 0.1);
});

test('groups are found despite HTML entities in titles, and the older curated copy is recommended', () => {
  const groups = buildGroups(readExport(csv(OLD, NEW)));
  assert.equal(groups.length, 1);
  const r = recommend(groups[0], { haveRest: false });
  assert.equal(r.keeper.id, '10');
  assert.deepEqual(
    r.retire.map((m) => m.id),
    ['90'],
  );
  assert.equal(r.confidence, 'Medium'); // no sales/reviews/URL data, so never High
  assert.ok(r.notes.some((n) => n.includes('same text apart from layout')));
  const newer = r.judged.find((m) => m.id === '90');
  assert.ok(newer.reasons.some((x) => x.includes('ExportYourStore')));
});

test('REST evidence can overturn the content-based recommendation and raise confidence', () => {
  const groups = buildGroups(readExport(csv(OLD, NEW)), [
    { id: 10, slug: 'aaa-box-case', total_sales: 0, rating_count: 0, date_created: '2026-05-01' },
    { id: 90, slug: 'aaa-box-case-2', total_sales: 7, rating_count: 3, date_created: '2026-09-02' },
  ]);
  const r = recommend(groups[0], { haveRest: true });
  assert.equal(r.keeper.id, '90'); // 7 sales (+5) and 3 reviews (+4) outweigh category/tags, which are easy to copy
  assert.equal(r.confidence, 'High');
  assert.ok(
    r.judged.find((m) => m.id === '90').reasons.some((x) => x.includes('7 recorded sales')),
  );
});

test('a draft never beats a published copy, and a single published copy needs no decision', () => {
  const draft = {
    ...NEW,
    ID: '5',
    Published: '-1',
    Categories: 'HomeGoods',
    Tags: 'a,b,c,d,e,f',
    Description: TEXT,
  };
  const groups = buildGroups(readExport(csv(OLD, draft)));
  const r = recommend(groups[0], { haveRest: false });
  assert.equal(r.keeper.id, '10');
  assert.equal(r.retire.length, 0);
  assert.deepEqual(
    r.drafts.map((d) => d.id),
    ['5'],
  );
  assert.equal(r.confidence, 'High');
});

test('different structures or materially different descriptions drop confidence to Low', () => {
  const variable = { ...NEW, Type: 'variable', SKU: 'PARENT_!' };
  const child = {
    ID: '91',
    Type: 'variation',
    SKU: 'PARENT-A',
    Parent: 'PARENT_!',
    'Regular price': '9',
  };
  let r = recommend(buildGroups(readExport(csv(OLD, variable, child)))[0], { haveRest: false });
  assert.equal(r.confidence, 'Low');
  assert.ok(r.notes.some((n) => n.includes('different structures')));

  const different = {
    ...NEW,
    Description:
      'A completely different description about a travel case for playing cards and tokens.',
  };
  r = recommend(buildGroups(readExport(csv(OLD, different)))[0], { haveRest: false });
  assert.equal(r.confidence, 'Low');
});

test('the report states it only recommends, and the CSV flags groups that need a decision', () => {
  const groups = buildGroups(readExport(csv(OLD, NEW)));
  const md = render(groups, { haveRest: false });
  assert.match(md, /Recommendations only/);
  assert.match(md, /Nothing has been merged, deleted, unpublished, or redirected/);
  assert.match(md, /product export only/);
  const lines = toCsv(groups, { haveRest: false }).trim().split('\n');
  assert.equal(lines.length, 2);
  assert.match(lines[1], /,10,"90","",Medium,yes$/);
});
