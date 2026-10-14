import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sanitizeRichText } from '@/components/RichText';
import { createWooClient, WooError } from '@/lib/catalog/woo/client';
import { readWooConfig } from '@/lib/catalog/woo/config';
import {
  createWooCatalogService,
  createWooLoader,
  type WooCatalogSnapshot,
} from '@/lib/catalog/woo/source';
import { createMockWoo, MOCK_KEY, MOCK_SECRET } from '../support/mock-woo.mjs';

const mock = createMockWoo();
let baseUrl = '';

const config = () => ({ baseUrl, key: MOCK_KEY, secret: MOCK_SECRET, ttlSeconds: 120 });

beforeAll(async () => {
  baseUrl = await mock.start();
});
afterAll(() => mock.stop());
beforeEach(() => {
  mock.log.requests.length = 0;
  mock.log.writes = 0;
  mock.log.unauthorized = 0;
});

describe('readWooConfig', () => {
  const ok = {
    WC_BASE_URL: 'https://kcprintworks.com/',
    WC_CONSUMER_KEY: 'ck_x',
    WC_CONSUMER_SECRET: 'cs_x',
  };

  it('accepts https and trims the base URL to its origin', () => {
    const result = readWooConfig(ok);
    expect(result).toMatchObject({
      ok: true,
      config: { baseUrl: 'https://kcprintworks.com', ttlSeconds: 120 },
    });
  });

  it('names what is missing without echoing values', () => {
    expect(readWooConfig({})).toEqual({
      ok: false,
      missing: ['WC_BASE_URL', 'WC_CONSUMER_KEY', 'WC_CONSUMER_SECRET'],
    });
    expect(readWooConfig({ ...ok, WC_CONSUMER_SECRET: ' ' })).toEqual({
      ok: false,
      missing: ['WC_CONSUMER_SECRET'],
    });
  });

  it('refuses plain http except to this machine, so a credentialed request is never sent in the clear', () => {
    expect(readWooConfig({ ...ok, WC_BASE_URL: 'http://kcprintworks.com' }).ok).toBe(false);
    expect(readWooConfig({ ...ok, WC_BASE_URL: 'http://127.0.0.1:3200' }).ok).toBe(true);
    expect(readWooConfig({ ...ok, WC_BASE_URL: 'not a url' }).ok).toBe(false);
  });

  it('bounds the refresh interval', () => {
    expect(readWooConfig({ ...ok, CATALOG_REVALIDATE_SECONDS: '1' })).toMatchObject({
      config: { ttlSeconds: 120 },
    });
    expect(readWooConfig({ ...ok, CATALOG_REVALIDATE_SECONDS: '30' })).toMatchObject({
      config: { ttlSeconds: 30 },
    });
  });
});

describe('the WooCommerce client', () => {
  it('sends only GET requests, with Basic credentials in a header and never in the URL', async () => {
    await createWooClient(config()).getAll('/products', { status: 'publish' });
    expect(mock.log.requests.length).toBeGreaterThan(0);
    expect(mock.log.requests.every((r) => r.method === 'GET')).toBe(true);
    expect(
      mock.log.requests.some((r) => r.search.includes(MOCK_KEY) || r.search.includes(MOCK_SECRET)),
    ).toBe(false);
    expect(mock.log.unauthorized).toBe(0);
    expect(mock.log.writes).toBe(0);
  });

  it('has no method that writes', () => {
    expect(Object.keys(createWooClient(config())).sort()).toEqual(['get', 'getAll']);
  });

  it('pages through every product', async () => {
    const rows = await createWooClient(config()).getAll('/products');
    expect(rows).toHaveLength(mock.data.products.length);
    const pages = mock.log.requests.filter((r) => r.path.endsWith('/products'));
    expect(pages.every((r) => r.search.includes('per_page=100'))).toBe(true);
  });

  it('reports bad credentials without revealing them', async () => {
    const client = createWooClient({ ...config(), key: 'ck_wrong', secret: 'cs_wrong' });
    const failure = await client.getAll('/products').catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(WooError);
    expect((failure as WooError).status).toBe(401);
    expect((failure as WooError).message).toBe('WooCommerce returned HTTP 401');
    expect(JSON.stringify(failure)).not.toContain('ck_wrong');
  });

  it('does not follow a redirect with the credentials attached', async () => {
    const fetchImpl = (async (_url: URL, init?: RequestInit) => {
      expect(init?.redirect).toBe('error');
      throw new TypeError('redirect mode is set to error');
    }) as unknown as typeof fetch;
    await expect(createWooClient(config(), fetchImpl).get('/products')).rejects.toThrow(
      'WooCommerce request failed',
    );
  });
});

describe('loading the whole catalog', () => {
  let snapshot: WooCatalogSnapshot;
  beforeAll(async () => {
    snapshot = await createWooLoader(createWooClient(config()))();
  });

  it('only asks for published products and fetches variations only for variable ones', async () => {
    mock.log.requests.length = 0;
    await createWooLoader(createWooClient(config()))();
    const products = mock.log.requests.find((r) => r.path.endsWith('/products'));
    expect(products?.search).toContain('status=publish');
    const variationCalls = mock.log.requests.filter((r) => r.path.endsWith('/variations'));
    expect(new Set(variationCalls.map((r) => r.path))).toEqual(
      new Set(['/wp-json/wc/v3/products/102/variations', '/wp-json/wc/v3/products/103/variations']),
    );
    expect(mock.log.writes).toBe(0);
  });

  it('keeps WooCommerce product IDs and addresses, and leaves out what is not for sale', () => {
    const bySlug = new Map(snapshot.products.map((p) => [p.slug, p]));
    expect(bySlug.get('synthetic-bag-tag')?.id).toBe(102);
    expect(bySlug.has('synthetic-draft')).toBe(false); // draft
    expect(bySlug.has('synthetic-hidden')).toBe(false); // hidden from the catalog
    expect(snapshot.skipped.map((s) => s.id)).toContain(108);
  });

  it('keeps the 169 "Any" variations with their own IDs and no invented options', () => {
    const tag = snapshot.products.find((p) => p.id === 102)!;
    expect(tag.variations).toHaveLength(169);
    expect(tag.variations[0]).toMatchObject({
      id: 5000,
      sku: 'SYN-BAG-0',
      attributes: { 'tag-color': '', 'text-color': '' },
    });
    expect(tag.variations.at(-1)?.id).toBe(5168);
    expect(tag.variations.every((v) => Object.values(v.attributes).every((o) => o === ''))).toBe(
      true,
    );
    expect(tag.attributes.find((a) => a.slug === 'tag-color')?.options).toHaveLength(13);
    // The marketplace attribute is not offered to shoppers.
    expect(tag.attributes.some((a) => a.name === 'Condition')).toBe(false);
    expect(tag.availability.madeToOrder).toBe(true);
  });

  it('keeps variation prices, sale prices, stock, and drops disabled variations', () => {
    const box = snapshot.products.find((p) => p.id === 103)!;
    expect(box.name).toBe('Synthetic Card Box & Sleeves');
    expect(box.variations.map((v) => v.id)).toEqual([7001, 7002, 7003]); // 7004 is private
    expect(box.variations[0]).toMatchObject({
      price: { amount: 1250 },
      regularPrice: { amount: 1500 },
      stockStatus: 'instock',
      attributes: { color: 'red' },
    });
    expect(box.variations[1]?.stockStatus).toBe('outofstock');
    expect(box.variations[2]).toMatchObject({
      price: { amount: 1400 },
      attributes: { color: 'dark-green' },
    });
    expect(box.price.amount).toBe(1250); // "from" price
    expect(box.availability.stockStatus).toBe('instock');
  });

  it('prices in whole cents and keeps simple-product stock', () => {
    expect(snapshot.products.find((p) => p.id === 101)?.price).toEqual({
      amount: 899,
      currency: 'USD',
    });
    expect(snapshot.products.find((p) => p.id === 105)?.availability.stockStatus).toBe(
      'outofstock',
    );
  });

  it('renders descriptions through the sanitizer (no script) and keeps formatting; script text never reaches the meta description', () => {
    const product = snapshot.products.find((p) => p.id === 101)!;
    const html = sanitizeRichText(product.descriptionHtml);
    expect(html).toContain('<strong>keychain</strong>');
    expect(html).not.toContain('script');
    expect(html).not.toContain('alert');
    expect(product.seo.description).toBe('A keychain with your name.');
  });

  it('uses a stored option schema when valid and otherwise only PROPOSES fields for personalized titles', () => {
    expect(
      snapshot.products.find((p) => p.id === 106)?.optionSchema.fields.map((f) => f.id),
    ).toEqual(['inscription']);
    expect(snapshot.products.find((p) => p.id === 101)?.optionSchema.fields.length).toBeGreaterThan(
      0,
    );
    expect(snapshot.products.find((p) => p.id === 105)?.optionSchema.fields).toEqual([]);
    expect(snapshot.proposedPersonalization).toBeGreaterThan(0);
  });

  it('lists real categories with products and names decoded', () => {
    const slugs = snapshot.categories.map((c) => c.slug);
    expect(slugs).toContain('gifts-keepsakes');
    expect(slugs).not.toContain('empty-category');
    expect(snapshot.categories.find((c) => c.slug === 'gifts-keepsakes')?.name).toBe(
      'Gifts & Keepsakes',
    );
  });
});

describe('the catalog source', () => {
  const makeService = () =>
    createWooCatalogService(createWooLoader(createWooClient(config())), 120);

  it('answers every CatalogSource question from the loaded copy, with one load', async () => {
    mock.log.requests.length = 0;
    const { source } = makeService();
    expect((await source.listProducts()).length).toBeGreaterThan(5);
    expect((await source.getProductBySlug('synthetic-bag-tag'))?.id).toBe(102);
    expect((await source.getProductById(103))?.slug).toBe('synthetic-card-box');
    expect(await source.getProductBySlug('nope')).toBeUndefined();
    expect(
      (await source.listProductsInCategory('game-accessories')).map((p) => p.id).sort(),
    ).toEqual([103, 105]);
    expect((await source.getCategoryBySlug('gifts-keepsakes'))?.name).toBe('Gifts & Keepsakes');
    const listed = (await source.listCategories()).map((c) => c.slug);
    expect(listed).not.toContain('uncategorized');
    expect(
      mock.log.requests.filter((r) => r.path.endsWith('/products') && r.search.includes('page=1'))
        .length,
    ).toBe(1);
  });

  it('shows an edit after a blocking invalidation, without a restart', async () => {
    const service = makeService();
    expect((await service.source.getProductById(101))?.price.amount).toBe(899);
    mock.edit(101, { price: '9.99', regular_price: '9.99' });
    expect((await service.source.getProductById(101))?.price.amount).toBe(899); // still the cached copy
    service.cache.invalidate({ blocking: true });
    expect((await service.source.getProductById(101))?.price.amount).toBe(999);
    mock.edit(101, { price: '8.99', regular_price: '8.99' });
  });

  it('keeps serving the last good catalog when WooCommerce goes down', async () => {
    const service = makeService();
    await service.source.listProducts();
    mock.data.failing = true;
    service.cache.invalidate({ blocking: true });
    expect((await service.source.listProducts()).length).toBeGreaterThan(5);
    expect(service.status().lastError).toBe('WooCommerce returned HTTP 503');
    mock.data.failing = false;
  });
});
