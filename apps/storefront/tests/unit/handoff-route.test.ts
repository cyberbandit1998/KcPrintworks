import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createMockWoo, MOCK_HANDOFF_SECRET, MOCK_KEY, MOCK_SECRET } from '../support/mock-woo.mjs';

const SERVICE_KEY = Symbol.for('kcpw.wooCatalogService');

/** POST /api/cart/handoff/ against the mock store (WooCommerce read API + kcpw-core stand-in). */
describe('POST /api/cart/handoff/', () => {
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

  async function route(extra: Record<string, string> = {}) {
    vi.stubEnv('CATALOG_SOURCE', 'woo');
    vi.stubEnv('WC_BASE_URL', mock.baseUrl);
    vi.stubEnv('WC_CONSUMER_KEY', MOCK_KEY);
    vi.stubEnv('WC_CONSUMER_SECRET', MOCK_SECRET);
    vi.stubEnv('CHECKOUT_ENABLED', 'true');
    vi.stubEnv('KCPW_API_URL', mock.baseUrl);
    vi.stubEnv('KCPW_HANDOFF_SECRET', MOCK_HANDOFF_SECRET);
    for (const [name, value] of Object.entries(extra)) vi.stubEnv(name, value);
    vi.resetModules();
    return (await import('@/app/api/cart/handoff/route')).POST;
  }

  const post = (body: unknown) =>
    new Request('http://localhost/api/cart/handoff/', {
      method: 'POST',
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });

  const card = (extra: Record<string, unknown> = {}) => ({
    productId: 103,
    variationId: 7001,
    quantity: 1,
    ...extra,
  });

  it('returns the shop’s single-use checkout link for a valid cart', async () => {
    const POST = await route();
    const before = mock.log.core.length;
    const response = await POST(post({ lines: [card({ quantity: 2 })] }));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const json = await response.json();
    expect(json.ok).toBe(true);
    expect(json.redirectUrl).toMatch(
      new RegExp(`^${mock.baseUrl}/\\?kcpw_handoff=[A-Za-z0-9_-]{43}$`),
    );
    // Exactly one signed call to the shop, with the subtotal THIS server computed (2 x $12.50) and no prices from the browser.
    const calls = mock.log.core.slice(before);
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0]!.body).expectedSubtotal).toBe(2500);
  });

  it('refuses when checkout is not switched on, and never calls the shop', async () => {
    const before = mock.log.core.length;
    const settings: Record<string, string>[] = [
      { CHECKOUT_ENABLED: 'false' },
      { KCPW_HANDOFF_SECRET: 'too-short' },
      { KCPW_API_URL: 'http://shop.example.com', WC_BASE_URL: '' }, // an explicit but non-https address is refused, not replaced
      { KCPW_API_URL: '', KCPW_SHOP_URL: '', WC_BASE_URL: '' },
    ];
    for (const env of settings) {
      const POST = await route(env);
      const response = await POST(post({ lines: [card()] }));
      expect(response.status, JSON.stringify(env)).toBe(403);
      expect(await response.json()).toEqual({ ok: false, error: 'checkout_disabled' });
    }
    expect(mock.log.core.length).toBe(before);
  });

  it('rejects a price, a total, or anything unexpected from the browser', async () => {
    const POST = await route();
    const before = mock.log.core.length;
    for (const body of [
      { lines: [card({ price: 1 })] },
      { lines: [card()], total: 1 },
      { lines: [card()], expectedSubtotal: 1 },
      { lines: [] },
      '{not json',
    ]) {
      const response = await POST(post(body));
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(await response.json()).toEqual({ ok: false, error: 'invalid_request' });
    }
    const big = await POST(post('x'.repeat(40_000)));
    expect(big.status).toBe(413);
    expect(mock.log.core.length).toBe(before);
  });

  it('stops at its own check when a line already has a problem (the shop is not asked)', async () => {
    const POST = await route();
    const before = mock.log.core.length;
    const response = await POST(post({ lines: [card({ variationId: 7002 })] })); // blue: sold out
    expect(response.status).toBe(422);
    const json = await response.json();
    expect(json).toMatchObject({
      ok: false,
      error: 'invalid_lines',
      lines: [{ index: 0, issues: [{ code: 'out_of_stock' }] }],
    });
    expect(mock.log.core.length).toBe(before);
  });

  it('passes on the shop’s own objections (a personalization WooCommerce does not know)', async () => {
    const POST = await route();
    // The personalized keychain has proposed fields on the page, but no stored setup in WooCommerce: the shop refuses it.
    const response = await POST(
      post({ lines: [{ productId: 101, quantity: 1, options: { name: 'Robin' } }] }),
    );
    expect(response.status).toBe(422);
    const json = await response.json();
    expect(json.error).toBe('invalid_lines');
    expect(JSON.stringify(json)).toContain('Unknown option');
  });

  it('says "changed" and reloads its catalog when WooCommerce disagrees with what it was showing', async () => {
    const POST = await route();
    // Prime the storefront's catalog copy, then change the price in the store behind its back.
    const { getCatalog } = await import('@/lib/catalog');
    expect((await getCatalog().getProductById(109))?.price.amount).toBe(300);
    mock.edit(109, { price: '3.50', regular_price: '3.50' });
    const stale = await POST(post({ lines: [{ productId: 109, quantity: 1 }] }));
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({ ok: false, error: 'changed' });
    // The very next read is fresh, so the cart shows the new price.
    expect((await getCatalog().getProductById(109))?.price.amount).toBe(350);
    mock.edit(109, { price: '3.00', regular_price: '3.00' });
  });

  it('answers 503 (and logs why, without secrets) when the shop cannot be reached or rejects the signature', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const POST = await route({ KCPW_HANDOFF_SECRET: 'q'.repeat(40) });
    const response = await POST(post({ lines: [card()] }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, error: 'unavailable' });
    expect(spy).toHaveBeenCalledOnce();
    expect(String(spy.mock.calls[0]![0])).toContain('KCPW_HANDOFF_SECRET');
    expect(String(spy.mock.calls[0]![0])).not.toContain('q'.repeat(40));
    spy.mockRestore();
  });
});
