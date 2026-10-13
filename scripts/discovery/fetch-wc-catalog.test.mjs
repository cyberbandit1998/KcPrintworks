import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createClient,
  fetchRestCatalog,
  fetchStoreCatalog,
  normalizeStoreProduct,
} from './fetch-wc-catalog.mjs';

/** A fake fetch that records every request and answers from a route table. */
function fakeFetch(routes) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url: new URL(url), init });
    const key = `${new URL(url).pathname}?page=${new URL(url).searchParams.get('page') ?? ''}`;
    const route = routes[key] ?? routes[new URL(url).pathname];
    if (!route) return new Response('{}', { status: 404 });
    const items = typeof route === 'function' ? route(calls.length) : route;
    if (items instanceof Response) return items;
    return new Response(JSON.stringify(items), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { impl, calls };
}

const sleep = async () => {};

test('every request is a GET with no body, whatever the call path', async () => {
  const { impl, calls } = fakeFetch({
    '/wp-json/wc/v3/products': [{ id: 1, type: 'simple' }],
  });
  const client = createClient({
    baseUrl: 'https://shop.example.com',
    credentials: { key: 'ck_x', secret: 'cs_y' },
    fetchImpl: impl,
    sleep,
  });
  await fetchRestCatalog(client);
  assert.ok(calls.length > 0);
  for (const call of calls) {
    assert.equal(call.init.method, 'GET');
    assert.equal(call.init.body, undefined);
  }
});

test('credentials travel in a header, never in the URL, and only over https', async () => {
  const { impl, calls } = fakeFetch({ '/wp-json/wc/v3/products': [] });
  const client = createClient({
    baseUrl: 'https://shop.example.com',
    credentials: { key: 'ck_secretkey', secret: 'cs_secretvalue' },
    fetchImpl: impl,
    sleep,
  });
  await fetchRestCatalog(client);
  const [{ url, init }] = calls;
  assert.ok(!url.href.includes('ck_secretkey') && !url.href.includes('cs_secretvalue'));
  assert.match(init.headers.authorization, /^Basic /);
  assert.equal(
    Buffer.from(init.headers.authorization.slice(6), 'base64').toString(),
    'ck_secretkey:cs_secretvalue',
  );
  assert.throws(
    () =>
      createClient({
        baseUrl: 'http://shop.example.com',
        credentials: { key: 'a', secret: 'b' },
        fetchImpl: impl,
      }),
    /non-https/,
  );
  // no credentials, no auth header
  const anonymous = createClient({ baseUrl: 'http://shop.example.com', fetchImpl: impl, sleep });
  await anonymous.get('/wp-json/wc/v3/products');
  assert.equal(calls.at(-1).init.headers.authorization, undefined);
});

test('does not follow redirects, so a credentialed request cannot be forwarded to another host', async () => {
  const { impl, calls } = fakeFetch({ '/x': [] });
  const client = createClient({
    baseUrl: 'https://shop.example.com',
    credentials: { key: 'a', secret: 'b' },
    fetchImpl: impl,
  });
  await client.get('/x');
  assert.equal(calls[0].init.redirect, 'error');
});

test('pages through results until a short page', async () => {
  const page = (n, count) =>
    Array.from({ length: count }, (_, i) => ({ id: n * 1000 + i, type: 'simple' }));
  const { impl, calls } = fakeFetch({
    '/wp-json/wc/v3/products?page=1': page(1, 100),
    '/wp-json/wc/v3/products?page=2': page(2, 100),
    '/wp-json/wc/v3/products?page=3': page(3, 7),
  });
  const client = createClient({
    baseUrl: 'https://shop.example.com',
    credentials: { key: 'a', secret: 'b' },
    fetchImpl: impl,
    sleep,
  });
  const products = await fetchRestCatalog(client);
  assert.equal(products.length, 207);
  assert.equal(calls.length, 3);
});

test('fetches variations only for variable products and keeps WooCommerce field names', async () => {
  const { impl, calls } = fakeFetch({
    '/wp-json/wc/v3/products': [
      { id: 10, type: 'variable', slug: 'tag', total_sales: 4, rating_count: 2 },
      { id: 11, type: 'simple', slug: 'case' },
    ],
    '/wp-json/wc/v3/products/10/variations': [
      { id: 101, attributes: [{ id: 0, name: 'Color', option: '' }] },
    ],
  });
  const client = createClient({
    baseUrl: 'https://shop.example.com',
    credentials: { key: 'a', secret: 'b' },
    fetchImpl: impl,
    sleep,
  });
  const out = await fetchRestCatalog(client);
  assert.equal(out[0].total_sales, 4);
  assert.equal(out[0].variation_details[0].attributes[0].option, '');
  assert.deepEqual(out[1].variation_details, []);
  assert.ok(!calls.some((c) => c.url.pathname.includes('/products/11/variations')));
});

test('retries rate limits and server errors with backoff, then gives up with a clear message', async () => {
  let n = 0;
  const waits = [];
  const impl = async () => {
    n += 1;
    return n < 3
      ? new Response('slow down', { status: 429, headers: { 'retry-after': '2' } })
      : new Response('[]', { status: 200 });
  };
  const client = createClient({
    baseUrl: 'https://shop.example.com',
    fetchImpl: impl,
    sleep: async (ms) => waits.push(ms),
  });
  const { data } = await client.get('/wp-json/wc/store/v1/products');
  assert.deepEqual(data, []);
  assert.deepEqual(waits, [2000, 2000]);

  const failing = createClient({
    baseUrl: 'https://shop.example.com',
    credentials: { key: 'ck_secretkey', secret: 'cs_secretvalue' },
    fetchImpl: async () => new Response('no', { status: 503 }),
    sleep,
  });
  await assert.rejects(
    () => failing.get('/wp-json/wc/v3/products', { status: 'any' }),
    (error) => {
      assert.match(error.message, /HTTP 503/);
      assert.ok(
        !error.message.includes('ck_secretkey') && !error.message.includes('cs_secretvalue'),
      );
      return true;
    },
  );
});

test('does not retry a client error such as 401', async () => {
  let n = 0;
  const client = createClient({
    baseUrl: 'https://shop.example.com',
    fetchImpl: async () => {
      n += 1;
      return new Response('{}', { status: 401 });
    },
    sleep,
  });
  await assert.rejects(() => client.get('/x'), /HTTP 401/);
  assert.equal(n, 1);
});

test('public Store API: normalizes to REST field names, never invents sales, and records failed variations', async () => {
  const { impl } = fakeFetch({
    '/wp-json/wc/store/v1/products': [
      {
        id: 10,
        name: 'Tag',
        slug: 'tag',
        permalink: 'https://shop.example.com/product/tag/',
        type: 'variable',
        prices: { price: '899', regular_price: '899', sale_price: '899', currency_minor_unit: 2 },
        on_sale: false,
        review_count: 3,
        is_in_stock: true,
        variations: [
          { id: 101, attributes: [{ name: 'Color', value: '' }] },
          { id: 102, attributes: [{ name: 'Color', value: 'Red' }] },
        ],
        attributes: [{ id: 0, name: 'Color', has_variations: true, terms: [{ name: 'Red' }] }],
      },
    ],
    '/wp-json/wc/store/v1/products/101': {
      id: 101,
      prices: { price: '899', regular_price: '899', currency_minor_unit: 2 },
      is_in_stock: true,
    },
    '/wp-json/wc/store/v1/products/102': new Response('{}', { status: 404 }),
  });
  const client = createClient({ baseUrl: 'https://shop.example.com', fetchImpl: impl, sleep });
  const [product] = await fetchStoreCatalog(client);
  assert.equal(product.price, '8.99');
  assert.equal(product.rating_count, 3);
  assert.equal(product.total_sales, undefined);
  assert.equal(product.snapshot_source, 'store-api');
  assert.deepEqual(product.variation_details[0].attributes, [{ name: 'Color', option: '' }]);
  assert.equal(product.variation_fetch_failures.length, 1);
  assert.match(product.variation_fetch_failures[0].error, /HTTP 404/);
});

test('normalizing a sparse product does not throw', () => {
  const p = normalizeStoreProduct({ id: 1, name: 'x' });
  assert.equal(p.id, 1);
  assert.deepEqual(p.images, []);
  assert.equal(p.price, '');
});
