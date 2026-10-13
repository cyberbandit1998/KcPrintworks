#!/usr/bin/env node
// Propose a cleaner category for each PUBLISHED product in a WooCommerce product CSV export.
//
//   node scripts/discovery/propose-categories.mjs products.csv [--csv out.csv]
//
// READ-ONLY. Output is a proposal for the owner to review and correct. Nothing is applied to any store.
// Rules run top to bottom; the first match wins. Every row shows the rule that matched, so a wrong
// assignment is fixed by editing one rule, not by trusting a black box.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { decodeEntities, readExport } from './analyze-wc-export.mjs';

export const CATEGORIES = [
  {
    name: 'Card Game Cases',
    slug: 'card-games',
    keepsExistingUrl: true,
    note: 'Rename of the existing "Card Games" category; keep the slug so the URL and its SEO title carry over.',
  },
  { name: 'Board Game Cases', slug: 'board-game-cases', note: 'New.' },
  {
    name: 'Playing Card & Deck Boxes',
    slug: 'card-and-deck-boxes',
    note: 'New. Standard decks, trading-card deck boxes, custom deck holders.',
  },
  {
    name: 'Battery & Utility Storage',
    slug: 'battery-and-utility-storage',
    note: 'New. Replaces "HomeGoods" and "Boxes & Bins".',
  },
  {
    name: 'Gifts, Tags & Desk Toys',
    slug: 'gifts-tags-and-desk-toys',
    note: 'New. Replaces "Desk Toys" (which currently holds a card game).',
  },
];

const BOARD_GAMES = /\b(catan|chameleon|guess who|trash pandas)\b/i;
const CARD_GAMES =
  /\b(skip[- ]?bo|phase 10|uno|flip 7|monopoly deal|five crowns|5 alive|taco cat|3 up 3 down|scrabble slam|super mallows|rook|beat the heat|fluxx|blink|sushi go|mood swings|that'?s not a hat|thats not a hat|the mind|euchre)\b/i;
const AMBIGUOUS = /\b(clue|tacta)\b/i;

/** @returns {{category: string, confidence: 'High'|'Medium'|'Low', rule: string, ownerCheck: string}} */
export function classify(title) {
  const t = decodeEntities(title);
  if (/\bbatter(y|ies)\b/i.test(t))
    return {
      category: 'Battery & Utility Storage',
      confidence: 'High',
      rule: 'title says "battery"',
      ownerCheck: '',
    };
  if (/\b(ammo|9mm|\d+rnd)\b/i.test(t))
    return {
      category: 'Battery & Utility Storage',
      confidence: 'Medium',
      rule: 'title says ammo/9mm (a storage box, not a battery)',
      ownerCheck:
        'Check Google Merchant Center and Meta feed policies for firearm-related items before including this product in feeds.',
    };
  if (/\b(bag tag|name tag|keychain)\b/i.test(t))
    return {
      category: 'Gifts, Tags & Desk Toys',
      confidence: 'High',
      rule: 'title says tag/keychain',
      ownerCheck: '',
    };
  if (/\b(puzzle|brain teaser|fidget)\b/i.test(t))
    return {
      category: 'Gifts, Tags & Desk Toys',
      confidence: 'High',
      rule: 'title says puzzle/teaser',
      ownerCheck: '',
    };
  if (AMBIGUOUS.test(t))
    return {
      category: 'Card Game Cases',
      confidence: 'Low',
      rule: 'ambiguous game: title mixes "card game" and "board game" / "token holder"',
      ownerCheck: 'Is this a card game or a board game case?',
    };
  if (BOARD_GAMES.test(t))
    return {
      category: 'Board Game Cases',
      confidence: 'Medium',
      rule: 'known board game name',
      ownerCheck: '',
    };
  if (/\b(bundle|combo)\b/i.test(t))
    return {
      category: 'Card Game Cases',
      confidence: 'Medium',
      rule: 'bundle/combo of card game cases',
      ownerCheck: 'Bundle: also surface it in a "Bundles" collection.',
    };
  if (CARD_GAMES.test(t))
    return {
      category: 'Card Game Cases',
      confidence: /card game/i.test(t) ? 'High' : 'Medium',
      rule: /card game/i.test(t)
        ? 'known card game, title says "card game"'
        : 'known card game name',
      ownerCheck: '',
    };
  if (/\b(bicycle|playing card|poker|pok[eé]mon|deck holder|deck organizer|deck box)\b/i.test(t))
    return {
      category: 'Playing Card & Deck Boxes',
      confidence: 'High',
      rule: 'title says playing card / deck holder / Pokémon',
      ownerCheck: '',
    };
  if (/\bcard game\b/i.test(t))
    return {
      category: 'Card Game Cases',
      confidence: 'Medium',
      rule: 'title says "card game"',
      ownerCheck: '',
    };
  return {
    category: 'Card Game Cases',
    confidence: 'Low',
    rule: 'no rule matched (default)',
    ownerCheck: 'Which category fits?',
  };
}

export function propose({ rows }) {
  return rows
    .filter((r) => (r.Type === 'simple' || r.Type === 'variable') && r.Published === '1')
    .map((r) => {
      const title = decodeEntities(r.Name);
      const c = classify(title);
      const info = CATEGORIES.find((x) => x.name === c.category);
      const personalized = /personali[sz]ed|custom name/i.test(title);
      return {
        id: r.ID,
        title,
        current: r.Categories.trim() || '-',
        proposed: c.category,
        slug: info?.slug ?? '',
        confidence: c.confidence,
        rule: c.rule,
        ownerCheck: c.ownerCheck,
        collections: [
          personalized ? 'Personalized' : '',
          Number(r['Sale price']) > 0 ? 'On Sale' : '',
        ]
          .filter(Boolean)
          .join(' + '),
      };
    });
}

export function toCsv(items) {
  const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
  const head =
    'product_id,title,current_category,proposed_category,proposed_slug,confidence,rule,collections,owner_check,owner_decision';
  return (
    [
      head,
      ...items.map((i) =>
        [
          i.id,
          q(i.title),
          q(i.current),
          q(i.proposed),
          i.slug,
          i.confidence,
          q(i.rule),
          q(i.collections),
          q(i.ownerCheck),
          '',
        ].join(','),
      ),
    ].join('\n') + '\n'
  );
}

export function summarize(items) {
  const byCat = new Map();
  for (const i of items) byCat.set(i.proposed, (byCat.get(i.proposed) ?? 0) + 1);
  return {
    total: items.length,
    perCategory: [...byCat.entries()].sort((a, b) => b[1] - a[1]),
    lowConfidence: items.filter((i) => i.confidence === 'Low'),
    currentlyUncategorized: items.filter((i) => i.current === 'Uncategorized').length,
    changesFromCurrent: items.filter((i) => i.current !== i.proposed).length,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const csvPath = args.includes('--csv') ? args[args.indexOf('--csv') + 1] : undefined;
  const file = args.find((a) => !a.startsWith('--') && a !== csvPath);
  if (!file) {
    console.error(
      'Usage: node scripts/discovery/propose-categories.mjs products.csv [--csv out.csv]',
    );
    process.exit(2);
  }
  const items = propose(readExport(readFileSync(file, 'utf8')));
  if (csvPath) writeFileSync(csvPath, toCsv(items));
  const s = summarize(items);
  console.log(
    `${s.total} published products; ${s.currentlyUncategorized} are Uncategorized today.`,
  );
  console.log(s.perCategory.map(([c, n]) => `${c}: ${n}`).join('\n'));
  console.log(
    `Low confidence (${s.lowConfidence.length}):`,
    s.lowConfidence.map((i) => `#${i.id}`).join(', '),
  );
  for (const i of items)
    console.log(
      `#${i.id}\t${i.confidence}\t${i.proposed}\t<- ${i.current}\t${i.title.slice(0, 60)}`,
    );
}
