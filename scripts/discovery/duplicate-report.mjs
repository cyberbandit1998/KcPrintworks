#!/usr/bin/env node
// Recommend which product to keep in each duplicate-title group of a WooCommerce product CSV export.
//
//   node scripts/discovery/duplicate-report.mjs products.csv [--rest products.json] [--csv out.csv]
//
// READ-ONLY. It never touches a store. It recommends; the owner decides. Nothing is merged, deleted,
// unpublished, or redirected by this tool or by anything it prints.
//
// The CSV export has no URLs, sales history, or reviews. If you also supply a WooCommerce REST dump
// (see scripts/discovery/fetch-wc-catalog.mjs), the report uses slug/permalink, total_sales, rating_count
// and creation date, and confidence can rise from Medium to High.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { decodeEntities, readExport } from './analyze-wc-export.mjs';

const IMPORT_FOOTER = /(?:<br\s*\/?>\s*)*Listed with ExportYourStore\.com/gi;
const HAS_IMPORT_FOOTER = /Listed with ExportYourStore\.com/i;

export function plainText(raw) {
  return decodeEntities(raw.replace(/\\n/g, ' '))
    .replace(IMPORT_FOOTER, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Jaccard similarity of 3-word shingles: 1 means the same text apart from layout. */
export function similarity(a, b) {
  const shingles = (text) => {
    const words = text.split(' ').filter(Boolean);
    const out = new Set();
    for (let i = 0; i + 2 < words.length; i += 1) out.add(words.slice(i, i + 3).join(' '));
    if (out.size === 0 && words.length > 0) out.add(words.join(' '));
    return out;
  };
  const A = shingles(a);
  const B = shingles(b);
  if (A.size === 0 && B.size === 0) return 1;
  let shared = 0;
  for (const s of A) if (B.has(s)) shared += 1;
  return shared / (A.size + B.size - shared);
}

const normalizeTitle = (s) =>
  decodeEntities(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
const stateOf = (r) =>
  r.Published === '1' ? 'published' : r.Published === '-1' ? 'draft' : 'other';
const imageNames = (r) =>
  r.Images.split(',')
    .map((u) => u.trim().split('/').pop())
    .filter(Boolean);
const imageStyle = (names) =>
  names.length === 0
    ? 'none'
    : names.some((n) => n.startsWith('il_'))
      ? 'etsy-style names'
      : 'other names';
const skuStyle = (sku) => {
  const s = sku.replace(/[_!]+$/, '');
  if (!s) return 'none';
  if (/^\d{9,12}_/.test(s)) return 'numeric-prefix';
  if (/^[A-Za-z0-9=_]{8,11}$/.test(s) && /[A-Z]/.test(s) && /[a-z]/.test(s))
    return 'random-looking';
  return 'readable';
};

export function buildGroups({ rows }, rest = []) {
  const top = rows.filter((r) => r.Type === 'simple' || r.Type === 'variable');
  const byId = new Map(top.map((r) => [r.ID, r]));
  const bySku = new Map(top.filter((r) => r.SKU).map((r) => [r.SKU, r]));
  const kids = new Map();
  for (const v of rows.filter((r) => r.Type === 'variation')) {
    const p = byId.get(v.Parent.replace(/^id:/, '')) ?? bySku.get(v.Parent);
    if (p) kids.set(p.ID, (kids.get(p.ID) ?? 0) + 1);
  }
  const restById = new Map(rest.map((p) => [String(p.id), p]));
  const facts = (r) => {
    const api = restById.get(r.ID);
    const names = imageNames(r);
    const categories = r.Categories.split(',')
      .map((c) => c.trim())
      .filter(Boolean);
    return {
      id: r.ID,
      type: r.Type,
      state: stateOf(r),
      sku: r.SKU,
      skuStyle: skuStyle(r.SKU),
      variations: kids.get(r.ID) ?? 0,
      price: r['Regular price'],
      salePrice: r['Sale price'],
      stock: r.Stock,
      images: names.length,
      imageStyle: imageStyle(names),
      uploadMonths: [
        ...new Set(
          r.Images.split(',')
            .map((u) => u.trim().split('/').slice(-3, -1).join('/'))
            .filter(Boolean),
        ),
      ],
      categories,
      realCategory: categories.some((c) => c !== 'Uncategorized'),
      tagCount: r.Tags.split(',').filter((t) => t.trim()).length,
      importFooter: HAS_IMPORT_FOOTER.test(r.Description),
      text: plainText(r.Description),
      hasMarketplaceAttrs: [1, 2, 3, 4, 5, 6, 7, 8, 9].some(
        (i) => r[`Attribute ${i} name`] === 'Condition',
      ),
      slug: api?.slug,
      permalink: api?.permalink,
      sales: api?.total_sales,
      reviews: api?.rating_count,
      created: api?.date_created,
      title: decodeEntities(r.Name),
    };
  };
  const groups = new Map();
  for (const r of top)
    groups.set(normalizeTitle(r.Name), [...(groups.get(normalizeTitle(r.Name)) ?? []), facts(r)]);
  return [...groups.values()].filter((g) => g.length > 1);
}

/**
 * Scores only order the copies; the reasons are what the owner reads.
 *
 * Weighting principle: evidence that is HARD to transfer to another product outweighs evidence that is easy
 * to copy. Sales history, reviews, and URL equity cannot be moved onto a keeper; categories, tags, and a
 * stray import footer can be fixed in minutes. So sales (+5) and reviews (+4) beat everything else, while
 * categories, tags, and age count +1 each and the footer costs -1.
 */
function judge(member, haveRest, groupMembers) {
  if (member.state !== 'published') return { score: -100, reasons: ['not published (draft)'] };
  const others = groupMembers.filter((m) => m !== member && m.state === 'published');
  let score = 0;
  const reasons = [];
  if (member.realCategory) {
    score += 1;
    reasons.push(
      `has a real category (${member.categories.join(', ')}), easy to copy to the keeper`,
    );
  } else reasons.push('only "Uncategorized"');
  reasons.push(
    `${member.tagCount} tags${member.tagCount >= 5 ? ' (easy to copy to the keeper)' : ''}`,
  );
  if (member.tagCount >= 5) score += 1;
  if (member.importFooter) {
    score -= 1;
    reasons.push('visible "Listed with ExportYourStore.com" footer (easy to remove)');
  }
  const published = groupMembers.filter((m) => m.state === 'published');
  if (Number(member.id) === Math.min(...published.map((m) => Number(m.id)))) {
    score += 1;
    reasons.push('oldest published copy (lowest ID), likely the longest-indexed URL (unverified)');
  }
  if (haveRest) {
    const mostOtherSales = Math.max(0, ...others.map((m) => m.sales ?? 0));
    const mostOtherReviews = Math.max(0, ...others.map((m) => m.reviews ?? 0));
    if ((member.sales ?? 0) > mostOtherSales) {
      score += 5;
      reasons.push(`${member.sales} recorded sales (more than the other copies; cannot be moved)`);
    }
    if ((member.reviews ?? 0) > mostOtherReviews) {
      score += 4;
      reasons.push(`${member.reviews} reviews (more than the other copies; cannot be moved)`);
    }
    if (member.slug && /-\d+$/.test(member.slug)) {
      score -= 1;
      reasons.push(`slug "${member.slug}" ends in a number (WordPress added it to avoid a clash)`);
    }
  }
  return { score, reasons };
}

export function recommend(group, { haveRest }) {
  const judged = group.map((m) => ({ ...m, ...judge(m, haveRest, group) }));
  const published = judged
    .filter((m) => m.state === 'published')
    .sort((a, b) => b.score - a.score || Number(a.id) - Number(b.id));
  const drafts = judged.filter((m) => m.state !== 'published');
  if (published.length === 0)
    return {
      judged,
      keeper: null,
      confidence: 'None',
      notes: ['No published member.'],
      retire: [],
      drafts,
    };
  if (published.length === 1) {
    return {
      judged,
      keeper: published[0],
      confidence: 'High',
      notes: [
        'Only one published copy; the other member(s) are unpublished drafts. No decision needed beyond what to do with the drafts.',
      ],
      retire: [],
      drafts,
    };
  }
  const [best, ...others] = published;
  const notes = [];
  let confidence = 'Medium';
  const structures = new Set(published.map((m) => `${m.type}:${m.variations}`));
  if (structures.size > 1) {
    confidence = 'Low';
    notes.push(
      'The copies have different structures (simple vs variable, or different variation counts), so they are not interchangeable; compare what each sells before choosing.',
    );
  }
  const sameText = others.map((o) => similarity(best.text, o.text));
  const minSimilarity = Math.min(...sameText);
  if (minSimilarity < 0.9) {
    confidence = 'Low';
    notes.push(`Descriptions differ materially (similarity ${Math.round(minSimilarity * 100)}%).`);
  } else
    notes.push(
      `Descriptions are the same text apart from layout and the import footer (similarity ${Math.round(minSimilarity * 100)}%).`,
    );
  if (others.some((o) => o.score === best.score)) {
    confidence = 'Low';
    notes.push('Two copies score equally; this is an owner decision.');
  }
  if (haveRest && confidence === 'Medium' && best.sales !== undefined) confidence = 'High';
  return { judged, keeper: best, confidence, notes, retire: others, drafts };
}

const WOULD_CHANGE = [
  'Either copy has sales, reviews, or inbound/search traffic the other lacks (needs the REST dump and Search Console).',
  "One copy's URL is the one in Google Merchant Center, Meta, or Klaviyo feeds.",
  'The custom SEO plugins hold per-product meta keyed to one product ID (see PLUGINS.md P5).',
  'The numeric part of the newer SKU is confirmed to be the Etsy listing/product ID and you want to keep that link on the product itself.',
];

export function render(groups, { haveRest }) {
  const out = [];
  out.push('# Duplicate Products: Keeper Recommendations (provisional)', '');
  out.push(
    "> **Recommendations only. Nothing has been merged, deleted, unpublished, or redirected, and none of it will be without the owner's explicit approval.**",
    '',
  );
  out.push(
    haveRest
      ? 'Evidence used: the product export **and** a WooCommerce REST dump (URLs, sales, reviews).'
      : 'Evidence used: the product export only. It has **no URLs/slugs, sales history, reviews, or search traffic**, so every recommendation below is provisional. Run `scripts/discovery/fetch-wc-catalog.mjs` and re-run this report to add them.',
    '',
  );
  const results = groups.map((g) => ({ g, r: recommend(g, { haveRest }) }));
  const published2 = results.filter((x) => x.r.keeper && x.r.retire.length > 0);
  out.push(`## Summary`, '');
  out.push(
    `- Duplicate groups: ${results.length}. Groups with two or more published copies (a keeper decision is needed): **${published2.length}**. Groups that are one published product plus old drafts: ${results.length - published2.length}.`,
  );
  out.push(
    `- Confidence: ${['High', 'Medium', 'Low'].map((c) => `${c} ${results.filter((x) => x.r.confidence === c && x.r.retire.length > 0).length}`).join(', ')} (among groups needing a decision).`,
    '',
  );
  out.push('## What would change a recommendation', '');
  for (const w of WOULD_CHANGE) out.push(`- ${w}`);
  out.push('', '## How the recommendation is made', '');
  out.push(
    'Published beats draft. Evidence that cannot be moved to another product outweighs evidence that is easy to copy. With REST data: more recorded sales (+5) and more reviews (+4) than the other copies. Always: a real category (+1), five or more tags (+1), lowest ID / oldest (+1), a visible import footer (-1), a numbered slug (-1). Confidence drops to Low when the copies have different structures, different descriptions, or tie, and cannot reach High without REST data. The scores only order the copies; read the reasons.',
    '',
  );
  for (const { g, r } of results) {
    out.push(`## ${g[0].title.slice(0, 90)}`, '');
    out.push(
      '| ID | Type | State | SKU style | Variations | Price (sale) | Stock | Images | Category | Tags | Import footer |',
      '|---|---|---|---|---|---|---|---|---|---|---|',
    );
    for (const m of g) {
      out.push(
        `| #${m.id} | ${m.type} | ${m.state} | ${m.skuStyle} | ${m.variations} | ${m.price || '-'} (${m.salePrice || '-'}) | ${m.stock || '-'} | ${m.images} (${m.imageStyle}; ${m.uploadMonths.join(', ') || '-'}) | ${m.categories.join(', ') || '-'} | ${m.tagCount} | ${m.importFooter ? 'yes' : 'no'} |`,
      );
    }
    if (haveRest) {
      out.push('', '| ID | Slug | Sales | Reviews | Created |', '|---|---|---|---|---|');
      for (const m of g)
        out.push(
          `| #${m.id} | ${m.slug ?? '-'} | ${m.sales ?? '-'} | ${m.reviews ?? '-'} | ${m.created ?? '-'} |`,
        );
    }
    out.push('');
    if (!r.keeper) out.push('**No published copy.**', '');
    else if (r.retire.length === 0) {
      out.push(`**Keeper: #${r.keeper.id}** (confidence ${r.confidence}). ${r.notes[0]}`, '');
      if (r.drafts.length)
        out.push(
          `Drafts: ${r.drafts.map((d) => `#${d.id}`).join(', ')} (not public; no action needed unless you want them removed).`,
          '',
        );
    } else {
      out.push(
        `**Recommended keeper: #${r.keeper.id}** (confidence **${r.confidence}**). Candidate(s) to retire later: ${r.retire.map((m) => `#${m.id}`).join(', ')}${r.drafts.length ? `; drafts: ${r.drafts.map((d) => `#${d.id}`).join(', ')}` : ''}.`,
        '',
      );
      out.push('Why:');
      for (const reason of r.keeper.reasons) out.push(`- #${r.keeper.id}: ${reason}`);
      for (const o of r.retire) for (const reason of o.reasons) out.push(`- #${o.id}: ${reason}`);
      for (const n of r.notes) out.push(`- ${n}`);
      out.push(
        '',
        'Approval needed before any of: copying data from the retired copy to the keeper, unpublishing, trashing, or adding a 301 redirect from the retired URL to the keeper.',
        '',
      );
    }
  }
  return out.join('\n');
}

export function toCsv(groups, { haveRest }) {
  const lines = ['group_title,keeper_id,retire_ids,draft_ids,confidence,needs_decision'];
  for (const g of groups) {
    const r = recommend(g, { haveRest });
    const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
    lines.push(
      [
        q(g[0].title),
        r.keeper?.id ?? '',
        q(r.retire.map((m) => m.id).join(' ')),
        q(r.drafts.map((m) => m.id).join(' ')),
        r.confidence,
        r.retire.length > 0 ? 'yes' : 'no',
      ].join(','),
    );
  }
  return lines.join('\n') + '\n';
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const flag = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const file = args.find((a) => !a.startsWith('--') && a !== flag('--rest') && a !== flag('--csv'));
  if (!file) {
    console.error(
      'Usage: node scripts/discovery/duplicate-report.mjs products.csv [--rest products.json] [--csv out.csv]',
    );
    process.exit(2);
  }
  const rest = flag('--rest') ? JSON.parse(readFileSync(flag('--rest'), 'utf8')) : [];
  const haveRest = rest.length > 0;
  const groups = buildGroups(readExport(readFileSync(file, 'utf8')), rest);
  if (flag('--csv')) writeFileSync(flag('--csv'), toCsv(groups, { haveRest }));
  console.log(render(groups, { haveRest }));
}
