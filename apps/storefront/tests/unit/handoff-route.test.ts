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
    vi.unstubAllGlobals();
    mock.setShopStatus({});
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
    // Two signed calls to the shop: who are you (the shop guard), then the handoff itself, with the subtotal THIS server computed
    // (2 x $12.50) and no prices from the browser.
    const calls = mock.log.core.slice(before);
    expect(calls.map((c) => `${c.method} ${c.route}`)).toEqual([
      'GET /kcpw/v1/status',
      'POST /kcpw/v1/cart/handoff',
    ]);
    expect(JSON.parse(calls[1]!.body).expectedSubtotal).toBe(2500);
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

/**
 * Real production and staging addresses against the stand-in shop: the shop's https address (the only kind production accepts) is
 * pointed at the local stand-in by a fetch wrapper, which also writes that address back into the checkout link it returns, so
 * the code under test sees exactly what it would see from https://shop.kcprintworks.com. SITE_ENV and NEXT_PUBLIC_SITE_URL
 * are build-time settings in the real image; here they are stubbed before the modules load, which is the same thing.
 */
describe('POST /api/cart/handoff/ with the real production and staging addresses', () => {
  const mock = createMockWoo();
  const SHOP = 'https://shop.kcprintworks.com';
  const handoffCalls = () => mock.log.core.filter((c) => c.route === '/kcpw/v1/cart/handoff');
  const statusCalls = () => mock.log.core.filter((c) => c.route === '/kcpw/v1/status');

  beforeAll(async () => {
    await mock.start();
  });
  afterAll(() => mock.stop());
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetModules();
    mock.setShopStatus({});
    delete (globalThis as Record<symbol, unknown>)[SERVICE_KEY];
  });

  /** Sends https://shop.kcprintworks.com/... to the stand-in and answers as if the stand-in were that host. */
  function shopAtItsRealAddress() {
    const real = fetch;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const target = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
      if (target.origin !== SHOP) return real(input, init);
      const answer = await real(new URL(target.pathname + target.search, mock.baseUrl), init);
      const text = (await answer.text()).replaceAll(mock.baseUrl, SHOP);
      return new Response(text, { status: answer.status, headers: answer.headers });
    });
  }

  async function route(env: Record<string, string>) {
    vi.stubEnv('CATALOG_SOURCE', 'woo');
    vi.stubEnv('WC_BASE_URL', mock.baseUrl);
    vi.stubEnv('WC_CONSUMER_KEY', MOCK_KEY);
    vi.stubEnv('WC_CONSUMER_SECRET', MOCK_SECRET);
    vi.stubEnv('KCPW_API_URL', SHOP);
    vi.stubEnv('KCPW_HANDOFF_SECRET', MOCK_HANDOFF_SECRET);
    vi.stubEnv('CHECKOUT_ENABLED', 'true');
    for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
    shopAtItsRealAddress();
    vi.resetModules();
    return (await import('@/app/api/cart/handoff/route')).POST;
  }

  const production = { SITE_ENV: 'production', NEXT_PUBLIC_SITE_URL: 'https://kcprintworks.com' };
  const staging = { SITE_ENV: 'staging', NEXT_PUBLIC_SITE_URL: 'https://dev.kcprintworks.com' };

  const send = (POST: (r: Request) => Promise<Response>) =>
    POST(
      new Request('https://kcprintworks.com/api/cart/handoff/', {
        method: 'POST',
        body: JSON.stringify({ lines: [{ productId: 103, variationId: 7001, quantity: 1 }] }),
      }),
    );

  describe('production (https://kcprintworks.com with the shop at https://shop.kcprintworks.com)', () => {
    it('hands a valid cart over to the shop’s own single-use link once everything is valid', async () => {
      mock.setShopStatus({ stripeTestMode: false, storefrontUrl: 'https://kcprintworks.com' });
      const POST = await route(production);
      const status = statusCalls().length;
      const handed = handoffCalls().length;
      const response = await send(POST);
      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.redirectUrl).toMatch(
        /^https:\/\/shop\.kcprintworks\.com\/\?kcpw_handoff=[A-Za-z0-9_-]{43}$/,
      );
      expect(statusCalls().length).toBe(status + 1);
      expect(handoffCalls().length).toBe(handed + 1);
    });

    it('is off by default: no CHECKOUT_ENABLED means 403 and the shop is never asked', async () => {
      const POST = await route({ ...production, CHECKOUT_ENABLED: '' });
      const before = mock.log.core.length;
      const response = await send(POST);
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ ok: false, error: 'checkout_disabled' });
      expect(mock.log.core.length).toBe(before);
    });

    it('refuses without the secret or the shop address, and never asks the shop', async () => {
      const before = mock.log.core.length;
      const cases: Record<string, string>[] = [
        { KCPW_HANDOFF_SECRET: '' },
        { KCPW_HANDOFF_SECRET: 'too-short' },
        { KCPW_API_URL: '', KCPW_SHOP_URL: '', WC_BASE_URL: '' },
        { KCPW_API_URL: 'http://shop.kcprintworks.com' },
        { CATALOG_SOURCE: 'fixtures' },
      ];
      for (const env of cases) {
        const POST = await route({ ...production, ...env });
        const response = await send(POST);
        expect(response.status, JSON.stringify(Object.keys(env))).toBe(403);
        expect(await response.json()).toEqual({ ok: false, error: 'checkout_disabled' });
      }
      expect(mock.log.core.length).toBe(before);
    });

    it('refuses a build whose storefront address is not https (the build setting cannot be repaired at run time)', async () => {
      const POST = await route({ ...production, NEXT_PUBLIC_SITE_URL: 'http://kcprintworks.com' });
      expect((await send(POST)).status).toBe(403);
    });

    it('refuses to hand over while the shop still returns shoppers to staging, and sends no cart', async () => {
      mock.setShopStatus({ storefrontUrl: 'https://dev.kcprintworks.com' });
      const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const POST = await route(production);
      const handed = handoffCalls().length;
      const response = await send(POST);
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ ok: false, error: 'checkout_disabled' });
      expect(handoffCalls().length).toBe(handed);
      expect(String(log.mock.calls[0]![0])).toContain('return_address_mismatch');
    });

    it('works while the shop does not yet report a return address (plugin 0.2.0), because that only affects error returns', async () => {
      const POST = await route(production);
      expect((await send(POST)).status).toBe(200);
    });

    it('does not trust a wrong secret: the shop’s refusal is 503 and nothing is handed over', async () => {
      const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const POST = await route({ ...production, KCPW_HANDOFF_SECRET: 'q'.repeat(40) });
      const handed = handoffCalls().length;
      const response = await send(POST);
      expect(response.status).toBe(503);
      expect(handoffCalls().length).toBe(handed);
      expect(String(log.mock.calls[0]![0])).not.toContain('q'.repeat(40));
    });
  });

  describe('staging (https://dev.kcprintworks.com) shares the shop and must never reach real payments', () => {
    it('hands a valid cart over while the shop reports Stripe TEST mode', async () => {
      mock.setShopStatus({ stripeTestMode: true });
      const POST = await route(staging);
      const response = await send(POST);
      expect(response.status).toBe(200);
      expect((await response.json()).redirectUrl).toMatch(
        /^https:\/\/shop\.kcprintworks\.com\/\?kcpw_handoff=/,
      );
    });

    it('refuses the moment the shared shop is switched to LIVE mode, and sends no cart', async () => {
      mock.setShopStatus({ stripeTestMode: false });
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const POST = await route(staging);
      const handed = handoffCalls().length;
      const response = await send(POST);
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ ok: false, error: 'checkout_disabled' });
      expect(handoffCalls().length).toBe(handed);
    });

    it('refuses when the shop does not say which mode it is in', async () => {
      mock.setShopStatus({ stripeTestMode: null, stripeActive: false });
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const POST = await route(staging);
      expect((await send(POST)).status).toBe(403);
    });

    it('follows the shop’s mode on the next click with no restart (nothing is cached)', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const POST = await route(staging);
      expect((await send(POST)).status).toBe(200);
      mock.setShopStatus({ stripeTestMode: false });
      expect((await send(POST)).status).toBe(403);
      mock.setShopStatus({ stripeTestMode: true });
      expect((await send(POST)).status).toBe(200);
    });

    it('is never made into a production build by the container environment', async () => {
      // SITE_ENV is written into the build; the route reads the build's value. In tests that value is what was stubbed before
      // loading, so a staging build asked to behave as production by a later environment change keeps the staging rules.
      mock.setShopStatus({ stripeTestMode: false, storefrontUrl: 'https://dev.kcprintworks.com' });
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const POST = await route(staging);
      vi.stubEnv('SITE_ENV', 'production');
      expect((await send(POST)).status).toBe(403);
    });
  });
});
