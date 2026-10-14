import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createMockWoo, MOCK_HANDOFF_SECRET, MOCK_KEY, MOCK_SECRET } from '../support/mock-woo.mjs';

/**
 * GET /api/checkout-status/ is the operator's view: it must say what the handoff route will decide, name every blocker, and never
 * show the secret or the shop's address. The shop's https address is pointed at the stand-in by a fetch wrapper (see
 * handoff-route.test.ts for why).
 */
describe('GET /api/checkout-status/', () => {
  const mock = createMockWoo();
  const SHOP = 'https://shop.kcprintworks.com';

  beforeAll(async () => {
    await mock.start();
  });
  afterAll(() => mock.stop());
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
    mock.setShopStatus({});
  });

  async function status(env: Record<string, string>) {
    const real = fetch;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const target = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
      return target.origin === SHOP
        ? real(new URL(target.pathname + target.search, mock.baseUrl), init)
        : real(input, init);
    });
    vi.stubEnv('CATALOG_SOURCE', 'woo');
    vi.stubEnv('WC_BASE_URL', mock.baseUrl);
    vi.stubEnv('KCPW_API_URL', SHOP);
    vi.stubEnv('KCPW_HANDOFF_SECRET', MOCK_HANDOFF_SECRET);
    vi.stubEnv('WC_CONSUMER_KEY', MOCK_KEY);
    vi.stubEnv('WC_CONSUMER_SECRET', MOCK_SECRET);
    for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
    vi.resetModules();
    const response = await (await import('@/app/api/checkout-status/route')).GET();
    expect(response.headers.get('cache-control')).toBe('no-store');
    const text = await response.text();
    expect(text.includes(MOCK_HANDOFF_SECRET), 'the secret must not appear').toBe(false);
    expect(text.includes(SHOP), 'the shop address must not appear').toBe(false);
    return JSON.parse(text) as Record<string, unknown>;
  }

  const production = {
    SITE_ENV: 'production',
    NEXT_PUBLIC_SITE_URL: 'https://kcprintworks.com',
    CHECKOUT_ENABLED: 'true',
  };
  const staging = {
    SITE_ENV: 'staging',
    NEXT_PUBLIC_SITE_URL: 'https://dev.kcprintworks.com',
    CHECKOUT_ENABLED: 'true',
  };

  it('reports off, with the environment, and names what is missing', async () => {
    expect(await status({ SITE_ENV: 'production', CHECKOUT_ENABLED: '' })).toEqual({
      enabled: false,
      environment: 'production',
      reason: 'not turned on',
    });
    expect(
      await status({
        ...production,
        NEXT_PUBLIC_SITE_URL: 'https://kcprintworks.com',
        KCPW_HANDOFF_SECRET: '',
      }),
    ).toMatchObject({
      enabled: false,
      environment: 'production',
      missing: ['KCPW_HANDOFF_SECRET (32 or more characters)'],
    });
  });

  it('production: allowed when the shop returns shoppers to this storefront', async () => {
    mock.setShopStatus({ stripeTestMode: false, storefrontUrl: 'https://kcprintworks.com' });
    expect(await status(production)).toMatchObject({
      enabled: true,
      environment: 'production',
      storefront: 'https://kcprintworks.com',
      allowed: true,
      returnAddress: 'matches',
      shop: { reachable: true, stripeTestMode: false, storefrontUrl: 'https://kcprintworks.com' },
    });
  });

  it('production: blocked, with the reason and what the shop reported, while the shop returns to staging', async () => {
    mock.setShopStatus({ storefrontUrl: 'https://dev.kcprintworks.com' });
    expect(await status(production)).toMatchObject({
      enabled: true,
      allowed: false,
      blocked: 'return_address_mismatch',
      shop: { reachable: true, storefrontUrl: 'https://dev.kcprintworks.com' },
    });
  });

  it('production: allowed but flagged when the plugin does not report a return address', async () => {
    expect(await status(production)).toMatchObject({
      allowed: true,
      returnAddress: 'not_reported',
      shop: { storefrontUrl: null },
    });
  });

  it('staging: allowed in test mode, blocked in live mode', async () => {
    expect(await status(staging)).toMatchObject({
      enabled: true,
      environment: 'staging',
      allowed: true,
      returnAddress: 'not_checked',
      shop: { stripeTestMode: true },
    });
    mock.setShopStatus({ stripeTestMode: false });
    expect(await status(staging)).toMatchObject({
      allowed: false,
      blocked: 'live_mode_blocked',
      shop: { reachable: true, stripeTestMode: false },
    });
  });

  it('says so when the shop cannot be reached or rejects the signature', async () => {
    expect(await status({ ...staging, KCPW_HANDOFF_SECRET: 'q'.repeat(40) })).toMatchObject({
      enabled: true,
      allowed: false,
      blocked: 'unreachable',
      shop: { reachable: false },
    });
  });
});
