import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readExport } from './analyze-wc-export.mjs';
import {
  classify,
  propose,
  summarize as summarizeCategories,
  toCsv as categoriesCsv,
} from './propose-categories.mjs';
import {
  IMPORTER_DEFAULTS,
  recommend,
  summarize as summarizeStock,
} from './inventory-recommendations.mjs';

test('classify routes products by explicit words and known game names, and marks ambiguity', () => {
  assert.equal(classify('AAA Battery Storage Box').category, 'Battery & Utility Storage');
  assert.equal(classify('3D Printed 31rnd 9mm Ammo Storage Box').confidence, 'Medium');
  assert.match(classify('3D Printed 31rnd 9mm Ammo Storage Box').ownerCheck, /feed policies/);
  assert.equal(
    classify('Personalized Bag Tag, Custom Name Tag').category,
    'Gifts, Tags & Desk Toys',
  );
  assert.equal(classify('Donut Jigsaw Puzzle').category, 'Gifts, Tags & Desk Toys');
  assert.equal(classify('Catan On The Road Travel Case').category, 'Board Game Cases');
  assert.equal(
    classify('Skip-Bo Card Game Travel Case: Storage Box & Card Holder').category,
    'Card Game Cases',
  );
  // A known game with "Deck Holder" in the title is still a card game case, not a generic deck box.
  assert.equal(
    classify('Flip 7 Card Game Storage Case with Deck Holder').category,
    'Card Game Cases',
  );
  assert.equal(
    classify('Card Game Deck Holder, Yellow Tabletop Organizer').category,
    'Playing Card & Deck Boxes',
  );
  assert.equal(
    classify('Bicycle Poker Card Case | Double Deck').category,
    'Playing Card & Deck Boxes',
  );
  // Clue and TACTA mix card-game and board-game wording: never guessed with confidence.
  assert.equal(classify('Clue Card Game Storage Case, Board Game Accessory').confidence, 'Low');
  assert.equal(classify('TACTA Game Storage Box Card Token Holder').confidence, 'Low');
  assert.equal(classify('Something Unrecognizable').confidence, 'Low');
});

const HEADER = [
  'ID',
  'Type',
  'SKU',
  'Name',
  'Published',
  'Categories',
  'Stock',
  'Sale price',
  'Parent',
  'Attribute 1 name',
  'Attribute 1 value(s)',
];
const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const csv = (...rows) =>
  [HEADER.join(','), ...rows.map((r) => HEADER.map((h) => q(r[h])).join(','))].join('\n');

test('propose only covers published products and the CSV leaves a column for the owner decision', () => {
  const items = propose(
    readExport(
      csv(
        {
          ID: '1',
          Type: 'simple',
          Name: 'AA Battery Box',
          Published: '1',
          Categories: 'Uncategorized',
          'Sale price': '9',
        },
        { ID: '2', Type: 'simple', Name: 'Draft Thing', Published: '-1' },
        { ID: '3', Type: 'variation', Name: 'AA Battery Box', Published: '1' },
      ),
    ),
  );
  assert.deepEqual(
    items.map((i) => i.id),
    ['1'],
  );
  assert.equal(items[0].collections, 'On Sale');
  assert.equal(summarizeCategories(items).currentlyUncategorized, 1);
  assert.match(categoriesCsv(items).split('\n')[0], /owner_decision$/);
});

test('inventory: made-to-order with default counts is High confidence "disable"; deck options are tracked per variation', () => {
  const made = {
    ID: '1',
    Type: 'simple',
    SKU: 'BOX',
    Name: 'Card Box',
    Published: '1',
    Stock: '20',
    'Attribute 1 name': 'Condition',
    'Attribute 1 value(s)': 'made_to_order',
  };
  const parent = {
    ID: '2',
    Type: 'variable',
    SKU: 'CASE_!',
    Name: 'Skip-Bo Case',
    Published: '1',
    'Attribute 1 name': 'Choose package',
    'Attribute 1 value(s)': 'Case Only, Case + Deck',
  };
  const plain = { ID: '3', Type: 'variation', SKU: 'CASE-RED', Parent: 'CASE_!', Stock: '20' };
  const deck = { ID: '4', Type: 'variation', SKU: 'CASE-RED-DECK', Parent: 'CASE_!', Stock: '20' };
  const lowStock = {
    ID: '5',
    Type: 'simple',
    SKU: 'LOW',
    Name: 'Low Box',
    Published: '1',
    Stock: '2',
  };
  const items = recommend(readExport(csv(made, parent, plain, deck, lowStock)));
  const byId = Object.fromEntries(items.map((i) => [i.id, i]));
  assert.equal(byId['1'].action, 'disable');
  assert.equal(byId['1'].confidence, 'High');
  assert.equal(byId['2'].action, 'track-some-variations');
  assert.deepEqual(byId['2'].componentVariations, ['CASE-RED-DECK']);
  assert.equal(byId['5'].atRisk, true);
  assert.equal(byId['5'].confidence, 'Medium');
  assert.ok(IMPORTER_DEFAULTS.has(15) && IMPORTER_DEFAULTS.has(20));
  assert.deepEqual(
    summarizeStock(items).atRisk.map((i) => i.id),
    ['5'],
  );
});

test('inventory: "Size: Single Deck / Double Deck" is a box size, not a purchased deck', () => {
  const parent = {
    ID: '1',
    Type: 'variable',
    SKU: 'BOX_!',
    Name: 'Card Box',
    Published: '1',
    'Attribute 1 name': 'Size',
    'Attribute 1 value(s)': 'Single Deck, Double Deck',
  };
  const v = { ID: '2', Type: 'variation', SKU: 'BOX-SINGLE', Parent: 'BOX_!', Stock: '20' };
  assert.equal(recommend(readExport(csv(parent, v)))[0].action, 'disable');
});

test('inventory: bundles and piece-count puzzles are questions, not guesses', () => {
  const bundle = {
    ID: '1',
    Type: 'simple',
    SKU: 'B',
    Name: 'Three Case Bundle',
    Published: '1',
    Stock: '10',
  };
  const puzzle = {
    ID: '2',
    Type: 'variable',
    SKU: 'P_!',
    Name: 'Donut Jigsaw Puzzle',
    Published: '1',
    'Attribute 1 name': 'Package',
    'Attribute 1 value(s)': 'Purple 36pc + Case',
  };
  const items = recommend(readExport(csv(bundle, puzzle)));
  assert.deepEqual(
    items.map((i) => i.action),
    ['ask', 'ask'],
  );
});
