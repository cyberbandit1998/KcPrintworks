#!/usr/bin/env node
// Analyze a WooCommerce product CSV export (Products > Export) and print a Markdown report.
//
//   node scripts/discovery/analyze-wc-export.mjs path/to/products.csv [--json]
//
// Read-only and dependency-free. The raw export may contain unpublished drafts, so keep it under
// docs/discovery/raw/ (gitignored) and commit only the reviewed summary in docs/discovery/INVENTORY.md.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** RFC 4180 parser: quoted fields, doubled quotes, CRLF/LF, embedded newlines, optional BOM. */
export function parseCsv(input) {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const records = [];
  let record = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') {
      record.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      record.push(field);
      field = '';
      records.push(record);
      record = [];
    } else field += ch;
  }
  if (field !== '' || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  return records;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export function decodeEntities(value) {
  return value.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (match, dec, hex, name) => {
    if (dec) return String.fromCodePoint(Number(dec));
    if (hex) return String.fromCodePoint(parseInt(hex, 16));
    return ENTITIES[name.toLowerCase()] ?? match;
  });
}

/** Rows become objects keyed by header. Short rows (earlier export batches) are padded with blanks. */
export function readExport(csvText) {
  const [header = [], ...records] = parseCsv(csvText);
  const widths = new Map();
  const rows = records
    .filter((r) => r.length > 1 || (r[0] ?? '') !== '')
    .map((r) => {
      widths.set(r.length, (widths.get(r.length) ?? 0) + 1);
      return Object.fromEntries(header.map((name, i) => [name, r[i] ?? '']));
    });
  return { header, rows, widths };
}

const MARKETPLACE_ATTRIBUTES = new Set([
  'Condition',
  'Condition Description',
  'MPN',
  'Primary color',
  'Secondary color',
  'Material multi',
  'Occasion',
  'Holiday',
]);

// Meta-key fingerprints of plugins that matter for this project. Absence is evidence, not proof:
// some plugins keep their data in their own tables or post types, which a product export cannot show.
const PLUGIN_FINGERPRINTS = [
  [/^_?(wc_)?facebook|^fb_/i, 'Facebook for WooCommerce'],
  [/_product_addons|product_addons/i, 'WooCommerce Product Add-Ons'],
  [/yith_wapo|wapo/i, 'YITH Product Add-Ons'],
  [/tm_meta|tmcp|themecomplete|tm_epo/i, 'Extra Product Options (ThemeComplete)'],
  [/_fpf|flexible_product_fields/i, 'Flexible Product Fields'],
  [/wcpa|wcff|thwepof|acf_/i, 'Other product-field plugin'],
  [/_yoast_wpseo|rank_math|_aioseo/i, 'SEO plugin'],
  [/etsy/i, 'Etsy-related plugin'],
];

const norm = (s) =>
  decodeEntities(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
const count = (items) => items.reduce((m, k) => m.set(k, (m.get(k) ?? 0) + 1), new Map());
const sorted = (map) =>
  [...map.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(b[0]));
const attributesOf = (row) =>
  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    .map((i) => ({
      name: (row[`Attribute ${i} name`] ?? '').trim(),
      value: (row[`Attribute ${i} value(s)`] ?? '').trim(),
      visible: row[`Attribute ${i} visible`],
    }))
    .filter((a) => a.name);

export function analyze({ header, rows, widths }) {
  const top = rows.filter((r) => r.Type === 'simple' || r.Type === 'variable');
  const variations = rows.filter((r) => r.Type === 'variation');
  const state = (r) =>
    r.Published === '1'
      ? 'published'
      : r.Published === '-1'
        ? 'draft'
        : r.Published === '0'
          ? 'private'
          : 'other';
  const published = top.filter((r) => state(r) === 'published');

  const byId = new Map(top.map((r) => [r.ID, r]));
  const bySku = new Map(top.filter((r) => r.SKU).map((r) => [r.SKU, r]));
  const parentOf = (v) => {
    const p = v.Parent.trim();
    return byId.get(p.replace(/^id:/, '')) ?? bySku.get(p);
  };
  const children = new Map();
  let orphans = 0;
  for (const v of variations) {
    const p = parentOf(v);
    if (!p) orphans += 1;
    else children.set(p.ID, [...(children.get(p.ID) ?? []), v]);
  }

  // Duplicates: identical normalized titles among top-level products.
  const titleGroups = new Map();
  for (const r of top) titleGroups.set(norm(r.Name), [...(titleGroups.get(norm(r.Name)) ?? []), r]);
  const duplicateGroups = [...titleGroups.values()].filter((g) => g.length > 1);

  const skuStyle = (sku) => {
    const s = sku.replace(/[_!]+$/, '');
    if (!s) return 'none';
    if (/^\d{9,12}_/.test(s)) return 'numeric-prefix';
    if (/^[A-Za-z0-9=_]{8,11}$/.test(s) && /[A-Z]/.test(s) && /[a-z]/.test(s))
      return 'random-looking';
    if (/^[A-Z0-9_-]+$/.test(s)) return 'readable-UPPER';
    return 'readable-lower';
  };

  const withoutAttrValues = variations.filter((v) => attributesOf(v).every((a) => !a.value));
  const partlyAny = variations.filter((v) => {
    const a = attributesOf(v);
    return a.some((x) => x.value) && a.some((x) => !x.value);
  });

  const attributeUse = new Map();
  for (const r of rows) {
    for (const a of attributesOf(r)) {
      const key = `${r.Type === 'variation' ? 'variation' : 'product'}:${a.name}`;
      const entry = attributeUse.get(key) ?? { rows: 0, visible: 0 };
      entry.rows += 1;
      if (a.visible === '1') entry.visible += 1;
      attributeUse.set(key, entry);
    }
  }
  const marketplaceAttrsVisible = [...attributeUse.entries()].filter(
    ([k, v]) => MARKETPLACE_ATTRIBUTES.has(k.split(':')[1]) && v.visible > 0,
  );
  const backslashValues = top
    .flatMap((r) => attributesOf(r))
    .filter((a) => a.value.includes('\\')).length;

  const metaColumns = header.filter((h) => h.startsWith('Meta: '));
  const fingerprints = new Map();
  for (const col of metaColumns)
    for (const [re, label] of PLUGIN_FINGERPRINTS)
      if (re.test(col.slice(6)))
        fingerprints.set(label, [...(fingerprints.get(label) ?? []), col.slice(6)]);

  const categories = count(
    top.flatMap((r) =>
      r.Categories.split(',')
        .map((c) => c.trim())
        .filter(Boolean),
    ),
  );
  const stockValues = rows.filter((r) => r.Stock.trim() !== '').map((r) => Number(r.Stock));
  const stockCounts = count(stockValues);
  const sale = rows.filter(
    (r) => r['Sale price'].trim() !== '' && r['Regular price'].trim() !== '',
  );
  const discountPercents = [
    ...new Set(
      sale.map((r) => Math.round(100 * (1 - Number(r['Sale price']) / Number(r['Regular price'])))),
    ),
  ].sort((a, b) => a - b);
  const personalizationSignal = /personali[sz]|custom name|your name|initials|emoji|monogram/i;
  const titleLengths = top.map((r) => decodeEntities(r.Name).length).sort((a, b) => a - b);

  return {
    file: {
      rows: rows.length,
      columns: header.length,
      rowWidths: sorted(widths).map(([w, n]) => ({ columns: w, rows: n })),
    },
    types: Object.fromEntries(count(rows.map((r) => r.Type))),
    topLevel: {
      total: top.length,
      simple: top.filter((r) => r.Type === 'simple').length,
      variable: top.filter((r) => r.Type === 'variable').length,
    },
    publishState: Object.fromEntries(count(top.map(state))),
    drafts: top
      .filter((r) => state(r) === 'draft')
      .map((r) => ({ id: r.ID, name: decodeEntities(r.Name).slice(0, 60) })),
    variations: {
      total: variations.length,
      orphans,
      noAttributeValueAtAll: withoutAttrValues.length,
      someButNotAllValues: partlyAny.length,
      perVariableProduct: top
        .filter((r) => r.Type === 'variable')
        .map((r) => ({
          id: r.ID,
          name: decodeEntities(r.Name).slice(0, 48),
          variations: (children.get(r.ID) ?? []).length,
        }))
        .sort((a, b) => b.variations - a.variations),
    },
    categories: sorted(categories).map(([name, products]) => ({ name, products })),
    uncategorizedPublished: published.filter((r) => r.Categories.trim() === 'Uncategorized').length,
    skus: {
      missing: rows.filter((r) => !r.SKU.trim()).map((r) => r.ID),
      duplicates: sorted(count(rows.map((r) => r.SKU).filter(Boolean)))
        .filter(([, n]) => n > 1)
        .map(([sku]) => sku),
      topLevelStyles: Object.fromEntries(count(top.map((r) => skuStyle(r.SKU)))),
      variableParentsEndingBang: top.filter((r) => r.Type === 'variable' && /_!$/.test(r.SKU))
        .length,
      numericPrefixRows: rows.filter((r) => /^\d{9,12}_/.test(r.SKU)).length,
      distinctNumericPrefixes: new Set(
        rows.map((r) => /^(\d{9,12})_/.exec(r.SKU)?.[1]).filter(Boolean),
      ).size,
    },
    duplicates: {
      groups: duplicateGroups.length,
      products: duplicateGroups.reduce((n, g) => n + g.length, 0),
      detail: duplicateGroups.map((g) => ({
        title: decodeEntities(g[0].Name).slice(0, 50),
        members: g.map((r) => ({
          id: r.ID,
          state: state(r),
          type: r.Type,
          skuStyle: skuStyle(r.SKU),
        })),
      })),
    },
    attributes: {
      usage: [...attributeUse.entries()]
        .map(([key, v]) => ({ key, ...v }))
        .sort((a, b) => b.rows - a.rows),
      marketplaceStyleAttributesShownToShoppers: [
        ...new Set(marketplaceAttrsVisible.map(([k]) => k.split(':')[1])),
      ],
      valuesContainingBackslash: backslashValues,
    },
    stock: {
      rowsWithManagedStock: stockValues.length,
      mostCommon: sorted(stockCounts)
        .slice(0, 5)
        .map(([qty, rows]) => ({ qty, rows })),
      min: Math.min(...stockValues),
      max: Math.max(...stockValues),
      backordersAllowed: rows.filter((r) => r['Backorders allowed?'] === '1').length,
    },
    prices: {
      rowsOnSale: sale.length,
      discountPercentsSeen: discountPercents,
      scheduledSales: rows.filter((r) => r['Date sale price starts'] || r['Date sale price ends'])
        .length,
      missingRegularPrice: rows
        .filter((r) => r.Type !== 'variable' && !r['Regular price'].trim())
        .map((r) => r.ID),
    },
    shipping: {
      weightValues: Object.fromEntries(
        sorted(count(rows.map((r) => r['Weight (lbs)']).filter(Boolean))),
      ),
      weightOutliersTopLevel: top
        .filter((r) => Number(r['Weight (lbs)']) >= 3)
        .map((r) => ({ id: r.ID, weight: r['Weight (lbs)'] })),
      shippingClasses: Object.fromEntries(count(rows.map((r) => r['Shipping class'] || '(none)'))),
    },
    content: {
      descriptionsWithHtml: top.filter((r) => /<[a-z][^>]*>/i.test(r.Description)).length,
      descriptionsWithLiteralBackslashN: top.filter((r) => r.Description.includes('\\n')).length,
      emptyShortDescriptions: top.filter((r) => !r['Short description'].trim()).length,
      namesWithHtmlEntities: top.filter((r) => /&(?:[a-z]+|#\d+);/i.test(r.Name)).length,
      titleLength: {
        min: titleLengths[0],
        median: titleLengths[Math.floor(titleLengths.length / 2)],
        max: titleLengths.at(-1),
        over80: titleLengths.filter((n) => n > 80).length,
      },
    },
    images: {
      hosts: Object.fromEntries(
        sorted(
          count(
            rows.flatMap((r) =>
              r.Images.split(',')
                .map((u) => u.trim())
                .filter(Boolean)
                .map((u) => {
                  try {
                    const x = new URL(u);
                    return `${x.host}${x.pathname.split('/').slice(0, 4).join('/')}`;
                  } catch {
                    return '(unparsable)';
                  }
                }),
            ),
          ),
        ).slice(0, 5),
      ),
      topLevelWithoutImages: top.filter((r) => !r.Images.trim()).length,
    },
    plugins: {
      metaColumns: metaColumns.map((c) => c.slice(6)),
      fingerprints: Object.fromEntries(fingerprints),
      productFieldOrAddonPluginMetaFound: [
        'WooCommerce Product Add-Ons',
        'YITH Product Add-Ons',
        'Extra Product Options (ThemeComplete)',
        'Flexible Product Fields',
        'Other product-field plugin',
      ].some((k) => fingerprints.has(k)),
    },
    personalization: {
      topLevelWithSignalInTitleOrDescription: top
        .filter((r) => personalizationSignal.test(`${r.Name} ${r.Description}`))
        .map((r) => ({ id: r.ID, name: decodeEntities(r.Name).slice(0, 56), state: state(r) })),
    },
    ecommerceFlags: {
      tax: Object.fromEntries(count(rows.map((r) => r['Tax status']))),
      inStockFlag: Object.fromEntries(count(rows.map((r) => r['In stock?']))),
    },
  };
}

function md(report) {
  const cell = (value) => String(value).replace(/\|/g, '/');
  const t = (rows, cols) =>
    [
      `| ${cols.join(' | ')} |`,
      `|${cols.map(() => '---').join('|')}|`,
      ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`),
    ].join('\n');
  const j = (o) =>
    Object.entries(o)
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ');
  const out = [];
  out.push('# WooCommerce export analysis', '');
  out.push(
    `- File: ${report.file.rows} rows, ${report.file.columns} columns. Row widths: ${report.file.rowWidths.map((w) => `${w.rows} rows x ${w.columns}`).join(', ')} (earlier export batches have fewer trailing columns; padded with blanks).`,
  );
  out.push(
    `- Row types: ${j(report.types)}. Top-level products: ${report.topLevel.total} (${report.topLevel.simple} simple, ${report.topLevel.variable} variable). Publish state: ${j(report.publishState)}.`,
  );
  out.push(
    `- Variations: ${report.variations.total}; unresolved parents: ${report.variations.orphans}; **with no attribute value at all ("Any"): ${report.variations.noAttributeValueAtAll}**; with only some values: ${report.variations.someButNotAllValues}.`,
  );
  out.push(
    `- Largest variable products: ${report.variations.perVariableProduct
      .slice(0, 5)
      .map((p) => `#${p.id} (${p.variations})`)
      .join(', ')}.`,
  );
  out.push(
    `- Categories: ${report.categories.map((c) => `${c.name} ${c.products}`).join(', ')}. Published but "Uncategorized": ${report.uncategorizedPublished}.`,
  );
  out.push(
    `- SKUs: missing on ${report.skus.missing.length} rows (${report.skus.missing.slice(0, 8).join(', ')}); duplicates: ${report.skus.duplicates.length}; top-level styles: ${j(report.skus.topLevelStyles)}; variable parents with "_!" suffix: ${report.skus.variableParentsEndingBang}; numeric-prefix SKU rows: ${report.skus.numericPrefixRows} (${report.skus.distinctNumericPrefixes} distinct prefixes).`,
  );
  out.push(
    `- **Duplicate titles: ${report.duplicates.products} products in ${report.duplicates.groups} groups.**`,
    '',
  );
  out.push(
    t(
      report.duplicates.detail.map((g) => [
        g.title,
        g.members.map((m) => `#${m.id} ${m.state} ${m.skuStyle}`).join('; '),
      ]),
      ['Title', 'Members'],
    ),
    '',
  );
  out.push(
    `- Stock: managed on ${report.stock.rowsWithManagedStock} rows; most common quantities ${report.stock.mostCommon.map((s) => `${s.qty} (${s.rows} rows)`).join(', ')}; range ${report.stock.min}-${report.stock.max}; backorders allowed: ${report.stock.backordersAllowed}.`,
  );
  out.push(
    `- Prices: ${report.prices.rowsOnSale} rows on sale, discount percents ${report.prices.discountPercentsSeen.join(', ')}; scheduled sales: ${report.prices.scheduledSales}; missing regular price: ${report.prices.missingRegularPrice.length}.`,
  );
  out.push(
    `- Weights (lbs): ${j(report.shipping.weightValues)}; top-level outliers >= 3: ${report.shipping.weightOutliersTopLevel.map((w) => `#${w.id}=${w.weight}`).join(', ') || 'none'}; shipping classes: ${j(report.shipping.shippingClasses)}.`,
  );
  out.push(
    `- Content: descriptions with HTML ${report.content.descriptionsWithHtml}, with literal "\\n" ${report.content.descriptionsWithLiteralBackslashN}; empty short descriptions ${report.content.emptyShortDescriptions}; names with HTML entities ${report.content.namesWithHtmlEntities}; title length min/median/max ${report.content.titleLength.min}/${report.content.titleLength.median}/${report.content.titleLength.max}, over 80: ${report.content.titleLength.over80}.`,
  );
  out.push(
    `- Marketplace-style attributes shown to shoppers: ${report.attributes.marketplaceStyleAttributesShownToShoppers.join(', ') || 'none'}; attribute values containing a backslash: ${report.attributes.valuesContainingBackslash}.`,
  );
  out.push(
    `- Images: ${j(report.images.hosts)}; top-level products without images: ${report.images.topLevelWithoutImages}.`,
  );
  out.push(
    `- Plugin fingerprints in meta columns: ${
      Object.entries(report.plugins.fingerprints)
        .map(([k, v]) => `${k} (${v.join(', ')})`)
        .join('; ') || 'none'
    }. Product-field/add-on plugin meta found: **${report.plugins.productFieldOrAddonPluginMetaFound}**.`,
  );
  out.push(
    `- Personalization wording in title/description: ${report.personalization.topLevelWithSignalInTitleOrDescription.map((p) => `#${p.id}`).join(', ') || 'none'}.`,
  );
  return out.join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [file, ...flags] = process.argv.slice(2);
  if (!file) {
    console.error('Usage: node scripts/discovery/analyze-wc-export.mjs <products.csv> [--json]');
    process.exit(2);
  }
  const report = analyze(readExport(readFileSync(file, 'utf8')));
  console.log(flags.includes('--json') ? JSON.stringify(report, null, 2) : md(report));
}
