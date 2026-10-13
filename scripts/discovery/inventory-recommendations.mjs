#!/usr/bin/env node
// Recommend, per PUBLISHED product, whether WooCommerce stock management should be off (made to order),
// tracked for specific variations (purchased components), or needs the owner's answer.
//
//   node scripts/discovery/inventory-recommendations.mjs products.csv [--csv out.csv]
//
// READ-ONLY. It changes no inventory setting anywhere; it only reads an export. The `owner_decision`
// column in the CSV is for the owner to fill in.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { decodeEntities, readExport } from './analyze-wc-export.mjs';

/** Quantities that the two import waves wrote as defaults, not as counted stock. */
export const IMPORTER_DEFAULTS = new Set([15, 20]);

/** Variation that bundles a purchased deck or cards with the printed case. */
const COMPONENT_SKU = /(?:^|[-_])DECK(?:[-_]|$)/;
const COMPONENT_VALUE = /\b(case \+ deck|case and game cards|card box and cards)\b/i;

export function recommend({ rows }) {
  const top = rows.filter(
    (r) => (r.Type === 'simple' || r.Type === 'variable') && r.Published === '1',
  );
  const byId = new Map(top.map((r) => [r.ID, r]));
  const bySku = new Map(top.filter((r) => r.SKU).map((r) => [r.SKU, r]));
  const kids = new Map();
  for (const v of rows.filter((r) => r.Type === 'variation')) {
    const p = byId.get(v.Parent.replace(/^id:/, '')) ?? bySku.get(v.Parent);
    if (p) kids.set(p.ID, [...(kids.get(p.ID) ?? []), v]);
  }

  return top.map((r) => {
    const title = decodeEntities(r.Name);
    const vs = kids.get(r.ID) ?? [];
    const quantities = (r.Type === 'variable' ? vs : [r])
      .map((x) => x.Stock.trim())
      .filter(Boolean)
      .map(Number);
    const managed = quantities.length > 0;
    const attrText = [1, 2, 3, 4, 5, 6, 7, 8, 9]
      .map((i) => r[`Attribute ${i} value(s)`])
      .join(' | ');
    const componentVariations = vs.filter(
      (v) => COMPONENT_SKU.test(v.SKU) || COMPONENT_VALUE.test(v.SKU),
    );
    const hasComponentOption = COMPONENT_VALUE.test(attrText) || componentVariations.length > 0;
    const madeToOrder = [1, 2, 3, 4, 5, 6, 7, 8, 9].some(
      (i) =>
        r[`Attribute ${i} name`] === 'Condition' &&
        /made_to_order/i.test(r[`Attribute ${i} value(s)`]),
    );
    const allDefault = managed && quantities.every((q) => IMPORTER_DEFAULTS.has(q));
    const lowest = managed ? Math.min(...quantities) : null;

    let action;
    let confidence;
    const reasons = [];
    const ownerCheck = [];

    if (/\b(bundle|combo)\b/i.test(`${title} ${r.SKU}`)) {
      action = 'ask';
      confidence = 'Low';
      reasons.push('a bundle/combo: stock depends on whether its parts are printed to order');
      ownerCheck.push('Is each bundle printed to order, or kept on a shelf?');
    } else if (/\bpuzzle\b/i.test(title) && /\d+\s*pc/i.test(attrText)) {
      action = 'ask';
      confidence = 'Low';
      reasons.push(
        'puzzle packages by piece count (e.g. 36pc, 60pc): unclear whether pieces are printed to order',
      );
      ownerCheck.push('Are puzzle pieces printed to order or pre-printed?');
    } else if (hasComponentOption) {
      action = 'track-some-variations';
      confidence = 'Medium';
      reasons.push(
        `${componentVariations.length || 'some'} option(s) include a deck or cards that you presumably buy rather than print (SKU/option "Case + Deck" style)`,
      );
      reasons.push('the plain case options are still made to order');
      ownerCheck.push(
        'Do the "+ Deck / + Cards" options include a purchased deck? If yes, track stock for those variations only (stock = decks on hand).',
      );
    } else {
      action = 'disable';
      if (madeToOrder && allDefault) {
        confidence = 'High';
        reasons.push(
          'marked made_to_order and every quantity is an importer default (15 or 20), so the counts carry no information',
        );
      } else if (madeToOrder) {
        confidence = 'Medium';
        reasons.push(
          'marked made_to_order, but a quantity is not an importer default (may be a manual count or reduced by sales)',
        );
        ownerCheck.push('Is any of these units printed ahead and kept in stock?');
      } else {
        confidence = 'Medium';
        reasons.push(
          '3D-printed product (you say most are made to order); not marked made_to_order in the data',
        );
        if (!allDefault && managed)
          ownerCheck.push('Quantities are not importer defaults. Real stock, or leftover edits?');
      }
    }

    const atRisk = managed && lowest !== null && lowest <= 5 && action !== 'track-some-variations';
    return {
      id: r.ID,
      title,
      type: r.Type,
      managed,
      quantities: [...new Set(quantities)].sort((a, b) => a - b),
      madeToOrderFlag: madeToOrder,
      action,
      confidence,
      reasons,
      ownerCheck,
      componentVariations: componentVariations.map((v) => v.SKU),
      atRisk,
    };
  });
}

export function summarize(items) {
  const by = (k) => items.filter((i) => i.action === k);
  return {
    total: items.length,
    disable: by('disable').length,
    trackSome: by('track-some-variations').length,
    ask: by('ask').length,
    managedToday: items.filter((i) => i.managed).length,
    atRisk: items.filter((i) => i.atRisk),
    nonDefaultQuantities: items.filter((i) => i.quantities.some((q) => !IMPORTER_DEFAULTS.has(q))),
  };
}

export function toCsv(items) {
  const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
  const head =
    'product_id,title,type,manages_stock_today,quantities_today,made_to_order_flag,recommendation,confidence,why,owner_check,component_variation_skus,owner_decision';
  return (
    [
      head,
      ...items.map((i) =>
        [
          i.id,
          q(i.title),
          i.type,
          i.managed ? 'yes' : 'no',
          q(i.quantities.join(' ')),
          i.madeToOrderFlag ? 'yes' : 'no',
          i.action,
          i.confidence,
          q(i.reasons.join('; ')),
          q(i.ownerCheck.join(' ')),
          q(i.componentVariations.join(' ')),
          '',
        ].join(','),
      ),
    ].join('\n') + '\n'
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const csvPath = args.includes('--csv') ? args[args.indexOf('--csv') + 1] : undefined;
  const file = args.find((a) => !a.startsWith('--') && a !== csvPath);
  if (!file) {
    console.error(
      'Usage: node scripts/discovery/inventory-recommendations.mjs products.csv [--csv out.csv]',
    );
    process.exit(2);
  }
  const items = recommend(readExport(readFileSync(file, 'utf8')));
  if (csvPath) writeFileSync(csvPath, toCsv(items));
  const s = summarize(items);
  console.log(`${s.total} published products; ${s.managedToday} manage stock today.`);
  console.log(
    `Recommendation: disable stock management ${s.disable}, track some variations ${s.trackSome}, ask owner ${s.ask}.`,
  );
  console.log(
    `At risk of showing out of stock soon (quantity 5 or less on a made-to-order item): ${s.atRisk.map((i) => `#${i.id} (${i.quantities.join('/')})`).join(', ') || 'none'}.`,
  );
  console.log(
    `Quantities that are not importer defaults on ${s.nonDefaultQuantities.length} products.`,
  );
  for (const i of items.filter((x) => x.action !== 'disable'))
    console.log(
      `#${i.id}\t${i.action}\t${i.confidence}\t${i.title.slice(0, 55)}\t${i.componentVariations.join(',')}`,
    );
}
