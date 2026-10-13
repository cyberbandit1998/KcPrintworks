#!/usr/bin/env node
// READ-ONLY snapshot of a WooCommerce catalog over HTTP. It issues GET requests and nothing else, and it
// never writes to the store. The output is a JSON file under docs/discovery/raw/ (gitignored) that the other
// discovery tools read (duplicate-report.mjs --rest, compare-variations.mjs).
//
// Two ways in. Pick the one that needs the least from the live site:
//
//   1. Public Store API: needs NO credentials and NO change in WordPress admin. Returns what a shopper's
//      browser can already see (names, prices, images, categories, variations). It has no sales history.
//        node scripts/discovery/fetch-wc-catalog.mjs --public --base https://kcprintworks.com --out docs/discovery/raw/rest-products.json
//
//   2. REST API v3 with a READ-ONLY key (WooCommerce > Settings > Advanced > REST API > Permissions: Read).
//      Adds drafts, total_sales, rating_count, creation dates. Creating the key is done by the owner, in
//      WordPress admin; this tool only reads it from the environment and never prints or stores it.
//        WC_BASE_URL=https://kcprintworks.com WC_CONSUMER_KEY=ck_... WC_CONSUMER_SECRET=cs_... \
//          node scripts/discovery/fetch-wc-catalog.mjs --out docs/discovery/raw/rest-products.json
//
// Never paste a key into an AI session or commit it. Orders, customers, and reviews (which carry reviewer
// names and emails) are never requested.
//
// STATUS: the request/pagination/retry/normalization logic is unit-tested against mock responses
// (fetch-wc-catalog.test.mjs). It has NOT been run against the live site: this sandbox cannot reach it, and
// the Store API response shapes below are written from the documented API, to be confirmed on first real run.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PER_PAGE = 100;
const MAX_ATTEMPTS = 4;

/** Allowed only for local testing; credentials never travel over plain http to a real host. */
const isLocalHost = (host) => host === 'localhost' || host === '127.0.0.1' || host === '[::1]';

/**
 * A client that can only GET. There is deliberately no way to pass a method, a body, or a header from outside.
 * `credentials` ({ key, secret }) are sent as HTTP Basic auth, only over https (or localhost for tests).
 */
export function createClient({
  baseUrl,
  credentials,
  fetchImpl = globalThis.fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  const base = new URL(baseUrl);
  if (base.protocol !== 'https:' && base.protocol !== 'http:') {
    throw new Error(`Unsupported protocol ${base.protocol}`);
  }
  if (credentials && base.protocol !== 'https:' && !isLocalHost(base.hostname)) {
    throw new Error('Refusing to send credentials over a non-https URL.');
  }
  const headers = {
    accept: 'application/json',
    'user-agent': 'kcpw-catalog-snapshot/1 (read-only)',
  };
  if (credentials) {
    headers.authorization = `Basic ${Buffer.from(`${credentials.key}:${credentials.secret}`).toString('base64')}`;
  }

  async function get(path, params = {}) {
    const url = new URL(path, base);
    for (const [name, value] of Object.entries(params)) url.searchParams.set(name, String(value));
    let lastStatus = 0;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const response = await fetchImpl(url, { method: 'GET', headers, redirect: 'error' });
      lastStatus = response.status;
      if (response.ok) {
        return {
          data: await response.json(),
          totalPages: Number(response.headers.get('x-wp-totalpages') ?? 0) || undefined,
        };
      }
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt === MAX_ATTEMPTS) break;
      const retryAfter = Number(response.headers.get('retry-after'));
      await sleep(
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 500,
      );
    }
    // The URL has no credentials in it (they travel in a header), so it is safe to show.
    throw new Error(`GET ${url.pathname}${url.search} failed with HTTP ${lastStatus}`);
  }

  return { get };
}

async function getAllPages(client, path, params = {}) {
  const items = [];
  for (let page = 1; ; page += 1) {
    const { data, totalPages } = await client.get(path, { ...params, per_page: PER_PAGE, page });
    if (!Array.isArray(data)) throw new Error(`${path} did not return a list`);
    items.push(...data);
    if (data.length < PER_PAGE || (totalPages && page >= totalPages)) return items;
  }
}

/** REST API v3 with a read-only key. Keeps WooCommerce's own field names so `--rest` consumers just work. */
export async function fetchRestCatalog(client, { log = () => {} } = {}) {
  const products = await getAllPages(client, '/wp-json/wc/v3/products', { status: 'any' });
  log(`${products.length} products`);
  const out = [];
  for (const product of products) {
    let variationDetails = [];
    if (product.type === 'variable') {
      variationDetails = await getAllPages(
        client,
        `/wp-json/wc/v3/products/${product.id}/variations`,
      );
    }
    out.push({ ...product, variation_details: variationDetails, snapshot_source: 'rest-v3' });
  }
  return out;
}

const minorToDecimal = (value, minorUnit) =>
  value === undefined || value === null || value === ''
    ? ''
    : (Number(value) / 10 ** minorUnit).toFixed(minorUnit);

/** Public Store API product -> the REST v3 field names the other tools read. Missing fields stay undefined. */
export function normalizeStoreProduct(p, variationDetails = []) {
  const minor = p.prices?.currency_minor_unit ?? 2;
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    permalink: p.permalink,
    type: p.type,
    status: 'publish', // the public API only exposes published products
    sku: p.sku,
    price: minorToDecimal(p.prices?.price, minor),
    regular_price: minorToDecimal(p.prices?.regular_price, minor),
    sale_price: p.on_sale ? minorToDecimal(p.prices?.sale_price, minor) : '',
    on_sale: p.on_sale,
    description: p.description,
    short_description: p.short_description,
    rating_count: p.review_count,
    average_rating: p.average_rating,
    stock_status:
      p.is_in_stock === undefined ? undefined : p.is_in_stock ? 'instock' : 'outofstock',
    images: (p.images ?? []).map((i) => ({ id: i.id, src: i.src, alt: i.alt, name: i.name })),
    categories: (p.categories ?? []).map((c) => ({ id: c.id, name: c.name, slug: c.slug })),
    tags: (p.tags ?? []).map((t) => ({ id: t.id, name: t.name, slug: t.slug })),
    attributes: (p.attributes ?? []).map((a) => ({
      id: a.id,
      name: a.name,
      variation: a.has_variations,
      options: (a.terms ?? []).map((t) => t.name),
    })),
    variations: (p.variations ?? []).map((v) => v.id),
    variation_details: variationDetails,
    snapshot_source: 'store-api',
  };
}

export function normalizeStoreVariation(variation, listed) {
  const minor = variation.prices?.currency_minor_unit ?? 2;
  return {
    id: variation.id,
    sku: variation.sku,
    price: minorToDecimal(variation.prices?.price, minor),
    regular_price: minorToDecimal(variation.prices?.regular_price, minor),
    sale_price: variation.on_sale ? minorToDecimal(variation.prices?.sale_price, minor) : '',
    stock_status:
      variation.is_in_stock === undefined
        ? undefined
        : variation.is_in_stock
          ? 'instock'
          : 'outofstock',
    // The parent's variation list is authoritative for which option was chosen; blank means "Any".
    attributes: (listed?.attributes ?? []).map((a) => ({ name: a.name, option: a.value ?? '' })),
  };
}

/** Public Store API: no credentials. Variation detail is best effort; a failed one is recorded, not guessed. */
export async function fetchStoreCatalog(client, { log = () => {} } = {}) {
  const listed = await getAllPages(client, '/wp-json/wc/store/v1/products');
  log(`${listed.length} published products`);
  const out = [];
  for (const product of listed) {
    const details = [];
    const failures = [];
    for (const listedVariation of product.variations ?? []) {
      try {
        const { data } = await client.get(`/wp-json/wc/store/v1/products/${listedVariation.id}`);
        details.push(normalizeStoreVariation(data, listedVariation));
      } catch (error) {
        failures.push({ id: listedVariation.id, error: String(error.message) });
        details.push(normalizeStoreVariation({ id: listedVariation.id }, listedVariation));
      }
    }
    const normalized = normalizeStoreProduct(product, details);
    if (failures.length > 0) normalized.variation_fetch_failures = failures;
    out.push(normalized);
  }
  return out;
}

function parseArgs(argv) {
  const args = { public: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--public') args.public = true;
    else if (arg === '--base') args.base = argv[(i += 1)];
    else if (arg === '--out') args.out = argv[(i += 1)];
    else throw new Error(`Unknown argument ${arg}`);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const baseUrl = args.base ?? process.env.WC_BASE_URL;
  if (!baseUrl || !args.out) {
    console.error(
      'Usage: node scripts/discovery/fetch-wc-catalog.mjs --out FILE (--public --base URL | with WC_BASE_URL, WC_CONSUMER_KEY, WC_CONSUMER_SECRET)',
    );
    process.exit(2);
  }
  const key = process.env.WC_CONSUMER_KEY;
  const secret = process.env.WC_CONSUMER_SECRET;
  if (!args.public && (!key || !secret)) {
    console.error('Set WC_CONSUMER_KEY and WC_CONSUMER_SECRET (read-only key), or use --public.');
    process.exit(2);
  }
  const client = createClient({
    baseUrl,
    credentials: args.public ? undefined : { key, secret },
  });
  const log = (message) => console.error(message);
  const products = args.public
    ? await fetchStoreCatalog(client, { log })
    : await fetchRestCatalog(client, { log });
  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, `${JSON.stringify(products, null, 2)}\n`);
  console.error(
    `Wrote ${products.length} products to ${args.out}. Nothing was changed on the store.`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
