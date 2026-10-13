#!/usr/bin/env node
// Compare the variations in a WooCommerce product EXPORT (CSV) with a live snapshot of the same store
// (fetch-wc-catalog.mjs output), to settle whether blank variation attributes really mean "Any".
//
//   node scripts/discovery/compare-variations.mjs products.csv rest-products.json [--json]
//
// READ-ONLY: reads two local files. It changes nothing anywhere.
//
// Why it exists: in the export, 256 of 259 variations have blank attribute values. A blank can be a genuine
// WooCommerce "Any" (the variation applies to every option), or an export that dropped the real value. Only
// the live store can say. Until this report is run, blanks stay UNVERIFIED and no variation is changed.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { decodeEntities, readExport } from './analyze-wc-export.mjs';

const attributeCells = (row) =>
  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    .map((i) => ({
      name: decodeEntities((row[`Attribute ${i} name`] ?? '').trim()),
      value: decodeEntities((row[`Attribute ${i} value(s)`] ?? '').trim()),
    }))
    .filter((a) => a.name);

/** Attribute values of a live variation, by lower-cased attribute name. Missing or blank both mean "Any". */
function liveValues(variation) {
  const out = new Map();
  for (const a of variation.attributes ?? []) {
    out.set(
      decodeEntities(String(a.name ?? '')).toLowerCase(),
      decodeEntities(String(a.option ?? '').trim()),
    );
  }
  return out;
}

const same = (a, b) =>
  a.toLowerCase().replace(/[^a-z0-9]+/g, '') === b.toLowerCase().replace(/[^a-z0-9]+/g, '');

/**
 * @returns {{ products: object[], totals: object }}
 */
export function compare({ rows }, live) {
  const liveById = new Map(live.map((p) => [String(p.id), p]));
  const top = rows.filter((r) => r.Type === 'variable');
  const byId = new Map(top.map((r) => [r.ID, r]));
  const bySku = new Map(top.filter((r) => r.SKU).map((r) => [r.SKU, r]));
  const kids = new Map();
  for (const v of rows.filter((r) => r.Type === 'variation')) {
    const parent = byId.get(v.Parent.replace(/^id:/, '')) ?? bySku.get(v.Parent);
    if (parent) kids.set(parent.ID, [...(kids.get(parent.ID) ?? []), v]);
  }

  const totals = {
    variations: 0,
    anyConfirmed: 0,
    exportBlankLiveHasValue: 0,
    valuesAgree: 0,
    valuesDisagree: 0,
    missingFromLive: 0,
    missingFromExport: 0,
    productsNotInLive: 0,
  };
  const products = [];

  for (const parent of top) {
    const exportKids = kids.get(parent.ID) ?? [];
    const api = liveById.get(parent.ID);
    if (!api) {
      totals.productsNotInLive += 1;
      products.push({
        id: parent.ID,
        title: decodeEntities(parent.Name),
        status: 'not in live snapshot',
        findings: [],
      });
      continue;
    }
    const liveKids = new Map((api.variation_details ?? []).map((v) => [String(v.id), v]));
    const findings = [];
    for (const kid of exportKids) {
      totals.variations += 1;
      const live = liveKids.get(kid.ID);
      if (!live) {
        totals.missingFromLive += 1;
        findings.push({ variation: kid.ID, sku: kid.SKU, kind: 'missing-from-live' });
        continue;
      }
      const values = liveValues(live);
      for (const cell of attributeCells(kid)) {
        const liveValue = values.get(cell.name.toLowerCase());
        const liveBlank = liveValue === undefined || liveValue === '';
        if (cell.value === '' && liveBlank) {
          totals.anyConfirmed += 1;
        } else if (cell.value === '' && !liveBlank) {
          totals.exportBlankLiveHasValue += 1;
          findings.push({
            variation: kid.ID,
            sku: kid.SKU,
            kind: 'export-blank-live-has-value',
            attribute: cell.name,
            live: liveValue,
          });
        } else if (!liveBlank && same(cell.value, liveValue)) {
          totals.valuesAgree += 1;
        } else {
          totals.valuesDisagree += 1;
          findings.push({
            variation: kid.ID,
            sku: kid.SKU,
            kind: 'values-differ',
            attribute: cell.name,
            export: cell.value,
            live: liveValue ?? '',
          });
        }
      }
    }
    const exportIds = new Set(exportKids.map((k) => k.ID));
    for (const id of liveKids.keys()) {
      if (!exportIds.has(id)) {
        totals.missingFromExport += 1;
        findings.push({ variation: id, kind: 'missing-from-export' });
      }
    }
    products.push({
      id: parent.ID,
      title: decodeEntities(parent.Name),
      status: findings.length === 0 ? 'consistent' : 'differences',
      exportVariations: exportKids.length,
      liveVariations: liveKids.size,
      findings,
    });
  }
  return { products, totals };
}

const MEANING = {
  'export-blank-live-has-value':
    'The export dropped a real value. The live store has a specific option here; the export would have wrongly made it "Any".',
  'values-differ':
    'Export and live store disagree on the chosen option. Investigate before importing anything.',
  'missing-from-live':
    'In the export but not on the live store (deleted or disabled since the export).',
  'missing-from-export':
    'On the live store but not in the export (added since, or the export batch was short).',
};

export function render({ products, totals }) {
  const lines = ['# Variation comparison: export vs live store', ''];
  lines.push('Nothing was changed. This only compares two files.', '');
  lines.push('| Result | Count |', '|---|---|');
  lines.push(`| Variations checked | ${totals.variations} |`);
  lines.push(
    `| Attribute cells blank in the export **and** blank on the live store: a genuine "Any" | ${totals.anyConfirmed} |`,
  );
  lines.push(
    `| Blank in the export but the live store has a value (export lost it) | ${totals.exportBlankLiveHasValue} |`,
  );
  lines.push(`| Values present and equal | ${totals.valuesAgree} |`);
  lines.push(`| Values present and different | ${totals.valuesDisagree} |`);
  lines.push(`| Variations only in the export | ${totals.missingFromLive} |`);
  lines.push(`| Variations only on the live store | ${totals.missingFromExport} |`);
  lines.push(`| Variable products not in the snapshot | ${totals.productsNotInLive} |`, '');
  const compared =
    totals.anyConfirmed +
    totals.valuesAgree +
    totals.exportBlankLiveHasValue +
    totals.valuesDisagree;
  const verdict =
    totals.variations === 0 || compared === 0
      ? 'Nothing could be compared: the snapshot has no variation detail for these products.'
      : totals.exportBlankLiveHasValue > 0 || totals.valuesDisagree > 0
        ? 'The blanks are NOT all confirmed: see the products below. Do not treat the export as the source of variation values.'
        : totals.missingFromLive > 0
          ? 'Every variation that could be compared agrees, but some export variations are not on the live store, so the blanks are only partly confirmed.'
          : 'The blanks are confirmed: every blank in the export is a real "Any" on the live store.';
  lines.push(`**Verdict:** ${verdict}`, '');
  for (const p of products.filter((x) => x.status !== 'consistent')) {
    lines.push(`## #${p.id} ${p.title}`, '', `Status: ${p.status}`, '');
    for (const f of p.findings) {
      const detail = f.attribute
        ? ` ${f.attribute}: export "${f.export ?? ''}" vs live "${f.live ?? ''}"`
        : '';
      lines.push(`- variation ${f.variation}${f.sku ? ` (${f.sku})` : ''}: ${f.kind}${detail}`);
    }
    lines.push('');
  }
  lines.push('## What the findings mean', '');
  for (const [kind, text] of Object.entries(MEANING)) lines.push(`- \`${kind}\`: ${text}`);
  return `${lines.join('\n')}\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  if (args.length !== 2) {
    console.error(
      'Usage: node scripts/discovery/compare-variations.mjs products.csv rest-products.json [--json]',
    );
    process.exit(2);
  }
  const result = compare(
    readExport(readFileSync(args[0], 'utf8')),
    JSON.parse(readFileSync(args[1], 'utf8')),
  );
  console.log(process.argv.includes('--json') ? JSON.stringify(result, null, 2) : render(result));
}
