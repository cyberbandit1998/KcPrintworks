import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { checkSignature, sign } from '@/lib/revalidate-auth';
import { isOptimizableImage, parseImageHosts, DEFAULT_IMAGE_HOSTS } from '@/lib/image-hosts';
import { createMockWoo, MOCK_KEY, MOCK_SECRET } from '../support/mock-woo.mjs';

const SECRET = 'a-long-shared-secret-for-tests';
const headers = (values: Record<string, string>) => ({
  get: (name: string) => values[name.toLowerCase()] ?? null,
});

describe('checkSignature', () => {
  const body = '{"id":101}';

  it('accepts the base64 signature a WooCommerce webhook sends', () => {
    expect(
      checkSignature(
        body,
        headers({ 'x-wc-webhook-signature': sign(body, SECRET).base64 }),
        SECRET,
      ),
    ).toBe('ok');
  });

  it('accepts the hex signature the freshness script sends, with or without the sha256= prefix', () => {
    const { hex } = sign(body, SECRET);
    expect(checkSignature(body, headers({ 'x-kcpw-signature': `sha256=${hex}` }), SECRET)).toBe(
      'ok',
    );
    expect(checkSignature(body, headers({ 'x-kcpw-signature': hex.toUpperCase() }), SECRET)).toBe(
      'ok',
    );
  });

  it('rejects a wrong secret, an altered body, and a missing signature', () => {
    const good = sign(body, SECRET);
    expect(
      checkSignature(
        body,
        headers({ 'x-wc-webhook-signature': sign(body, 'another-secret-entirely').base64 }),
        SECRET,
      ),
    ).toBe('invalid');
    expect(
      checkSignature('{"id":102}', headers({ 'x-wc-webhook-signature': good.base64 }), SECRET),
    ).toBe('invalid');
    expect(checkSignature(body, headers({}), SECRET)).toBe('missing');
    expect(checkSignature(body, headers({ 'x-kcpw-signature': 'sha256=' }), SECRET)).toBe(
      'invalid',
    );
  });

  it('is off until a long enough secret is configured', () => {
    const signature = headers({ 'x-wc-webhook-signature': sign(body, 'short').base64 });
    expect(checkSignature(body, signature, undefined)).toBe('not_configured');
    expect(checkSignature(body, signature, '')).toBe('not_configured');
    expect(checkSignature(body, signature, 'short')).toBe('not_configured');
  });
});

describe('image hosts', () => {
  it('defaults to the owner domain and its subdomains', () => {
    expect(parseImageHosts(undefined)).toEqual(DEFAULT_IMAGE_HOSTS);
    expect(parseImageHosts('not valid!, ')).toEqual(DEFAULT_IMAGE_HOSTS);
    expect(parseImageHosts('Cdn.Example.com, **.example.org')).toEqual([
      'cdn.example.com',
      '**.example.org',
    ]);
  });

  it('optimizes this site and allowed https hosts only', () => {
    const hosts = DEFAULT_IMAGE_HOSTS;
    expect(isOptimizableImage('/images/hero-banner.jpg', hosts)).toBe(true);
    expect(isOptimizableImage('https://kcprintworks.com/wp-content/uploads/a.jpg', hosts)).toBe(
      true,
    );
    expect(
      isOptimizableImage('https://shop.kcprintworks.com/wp-content/uploads/a.jpg', hosts),
    ).toBe(true);
    expect(isOptimizableImage('https://cdn.example.net/a.jpg', hosts)).toBe(false);
    expect(isOptimizableImage('https://evilkcprintworks.com/a.jpg', hosts)).toBe(false);
    expect(isOptimizableImage('https://kcprintworks.com.evil.net/a.jpg', hosts)).toBe(false);
    expect(isOptimizableImage('http://kcprintworks.com/a.jpg', hosts)).toBe(false);
    expect(isOptimizableImage('//kcprintworks.com/a.jpg', hosts)).toBe(false);
    expect(isOptimizableImage('nonsense', hosts)).toBe(false);
  });
});

const SERVICE_KEY = Symbol.for('kcpw.wooCatalogService');

describe('/api/revalidate and /api/catalog-status with CATALOG_SOURCE=woo', () => {
  const mock = createMockWoo();

  beforeAll(async () => {
    await mock.start();
  });
  afterAll(() => mock.stop());
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    delete (globalThis as Record<symbol, unknown>)[SERVICE_KEY];
  });

  async function load(extra: Record<string, string> = {}) {
    vi.stubEnv('CATALOG_SOURCE', 'woo');
    vi.stubEnv('WC_BASE_URL', mock.baseUrl);
    vi.stubEnv('WC_CONSUMER_KEY', MOCK_KEY);
    vi.stubEnv('WC_CONSUMER_SECRET', MOCK_SECRET);
    vi.stubEnv('REVALIDATE_SECRET', SECRET);
    for (const [name, value] of Object.entries(extra)) vi.stubEnv(name, value);
    vi.resetModules();
    const revalidate = await import('@/app/api/revalidate/route');
    const status = await import('@/app/api/catalog-status/route');
    const catalog = await import('@/lib/catalog');
    return { ...revalidate, status: status.GET, catalog: catalog.getCatalog() };
  }

  const post = (body: string, signatureHeaders: Record<string, string>) =>
    new Request('http://localhost/api/revalidate/', {
      method: 'POST',
      body,
      headers: signatureHeaders,
    });

  it('reports what the storefront shows, without credentials or the WooCommerce address', async () => {
    const { status } = await load();
    const response = await status();
    const text = await response.text();
    const json = JSON.parse(text);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(json.source).toBe('woo');
    expect(json.counts.products).toBeGreaterThan(5);
    expect(json.status.lastError).toBeNull();
    expect(json.products.find((p: { id: number }) => p.id === 102)).toMatchObject({
      slug: 'synthetic-bag-tag',
      variations: 169,
    });
    expect(text).not.toContain(MOCK_KEY);
    expect(text).not.toContain(MOCK_SECRET);
    expect(text).not.toContain(mock.baseUrl);
    expect(text).not.toContain(SECRET);
  });

  it('refuses unsigned, wrongly signed, and unconfigured requests', async () => {
    const { POST } = await load();
    expect((await POST(post('{}', {}))).status).toBe(401);
    expect((await POST(post('{}', { 'x-kcpw-signature': 'sha256=00' }))).status).toBe(401);
    const off = await load({ REVALIDATE_SECRET: '' });
    expect(
      (await off.POST(post('{}', { 'x-kcpw-signature': `sha256=${sign('{}', SECRET).hex}` })))
        .status,
    ).toBe(503);
  });

  it('refuses an oversized body', async () => {
    const { POST } = await load();
    const body = 'x'.repeat(300_000);
    expect((await POST(post(body, { 'x-kcpw-signature': sign(body, SECRET).hex }))).status).toBe(
      413,
    );
  });

  it('a signed request makes the very next read show the edited product', async () => {
    const { POST, catalog } = await load();
    expect((await catalog.getProductById(101))?.price.amount).toBe(899);
    mock.edit(101, { price: '10.49', regular_price: '10.49' });
    expect((await catalog.getProductById(101))?.price.amount).toBe(899); // cached until told otherwise
    const body = 'webhook_id=1'; // what WooCommerce sends when a webhook is created
    const response = await POST(
      post(body, { 'x-wc-webhook-signature': sign(body, SECRET).base64 }),
    );
    expect(response.status).toBe(202);
    expect((await catalog.getProductById(101))?.price.amount).toBe(1049);
    mock.edit(101, { price: '8.99', regular_price: '8.99' });
    expect(mock.log.writes).toBe(0);
  });

  it('is not an endpoint when another catalog source is in use', async () => {
    const { POST } = await load({ CATALOG_SOURCE: 'fixtures' });
    expect((await POST(post('{}', {}))).status).toBe(404);
  });

  it('says what is missing when WooCommerce is not configured', async () => {
    const { status } = await load({ WC_CONSUMER_SECRET: '' });
    const response = await status();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      configured: false,
      missing: ['WC_CONSUMER_SECRET'],
    });
  });
});
