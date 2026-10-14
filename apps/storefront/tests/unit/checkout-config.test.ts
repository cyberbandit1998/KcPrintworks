import { afterEach, describe, expect, it, vi } from 'vitest';
import { readCheckoutStatus } from '@/lib/checkout';

const SECRET = 'x'.repeat(40);
const on = {
  CHECKOUT_ENABLED: 'true',
  KCPW_API_URL: 'https://shop.example.com',
  KCPW_HANDOFF_SECRET: SECRET,
};

describe('checkout is off unless an operator deliberately turns it on', () => {
  it('is off by default, whatever else is set', () => {
    expect(readCheckoutStatus({}, false)).toMatchObject({ enabled: false });
    expect(readCheckoutStatus({ ...on, CHECKOUT_ENABLED: undefined }, false).enabled).toBe(false);
    for (const value of ['', 'false', '1', 'yes', 'TRUE', 'True']) {
      expect(readCheckoutStatus({ ...on, CHECKOUT_ENABLED: value }, false).enabled, value).toBe(
        false,
      );
    }
  });

  it('needs the shop address (https) and a long secret, and names what is missing without echoing values', () => {
    expect(readCheckoutStatus({ CHECKOUT_ENABLED: 'true' }, false)).toMatchObject({
      enabled: false,
      missing: ['KCPW_API_URL', 'KCPW_HANDOFF_SECRET (32 or more characters)'],
    });
    const short = readCheckoutStatus({ ...on, KCPW_HANDOFF_SECRET: 'short-secret-value' }, false);
    expect(short.enabled).toBe(false);
    expect(JSON.stringify(short)).not.toContain('short-secret-value');
    expect(
      readCheckoutStatus({ ...on, KCPW_API_URL: 'http://shop.example.com' }, false),
    ).toMatchObject({
      enabled: false,
      missing: ['KCPW_API_URL (must be https)'],
    });
    expect(readCheckoutStatus({ ...on, KCPW_API_URL: 'not a url' }, false).enabled).toBe(false);
  });

  it('finds the shop address under the names operators actually use', () => {
    // The staging server that reported "Checkout is not connected" had CHECKOUT_ENABLED, KCPW_SHOP_URL and WC_BASE_URL set,
    // and nothing named KCPW_API_URL: the address was never read.
    const reported = {
      CHECKOUT_ENABLED: 'true',
      KCPW_SHOP_URL: 'https://shop.kcprintworks.com',
      WC_BASE_URL: 'https://shop.kcprintworks.com',
    };
    expect(readCheckoutStatus(reported, false)).toMatchObject({
      enabled: false,
      missing: ['KCPW_HANDOFF_SECRET (32 or more characters)'],
    });
    expect(readCheckoutStatus({ ...reported, KCPW_HANDOFF_SECRET: SECRET }, false)).toEqual({
      enabled: true,
      config: { apiUrl: 'https://shop.kcprintworks.com', secret: SECRET },
    });
    // With neither checkout-specific name, the WooCommerce address (the same site) is used.
    expect(
      readCheckoutStatus(
        {
          CHECKOUT_ENABLED: 'true',
          WC_BASE_URL: 'https://shop.example.com',
          KCPW_HANDOFF_SECRET: SECRET,
        },
        false,
      ),
    ).toMatchObject({ enabled: true, config: { apiUrl: 'https://shop.example.com' } });
  });

  it('prefers the most specific name, and an empty value (compose passes unset ones as empty) falls through', () => {
    const env = {
      ...on,
      KCPW_API_URL: 'https://api.example.com',
      KCPW_SHOP_URL: 'https://shop.example.com',
      WC_BASE_URL: 'https://woo.example.com',
    };
    const apiUrl = (e: Record<string, string>) => {
      const status = readCheckoutStatus(e, false);
      return status.enabled ? status.config.apiUrl : undefined;
    };
    expect(apiUrl(env)).toBe('https://api.example.com');
    expect(apiUrl({ ...env, KCPW_API_URL: '' })).toBe('https://shop.example.com');
    expect(apiUrl({ ...env, KCPW_API_URL: '  ', KCPW_SHOP_URL: '' })).toBe(
      'https://woo.example.com',
    );
  });

  it('applies the same https rule to whichever name supplied the address', () => {
    const status = readCheckoutStatus(
      {
        CHECKOUT_ENABLED: 'true',
        KCPW_HANDOFF_SECRET: SECRET,
        WC_BASE_URL: 'http://woo.example.com',
      },
      false,
    );
    expect(status).toMatchObject({ enabled: false, missing: ['WC_BASE_URL (must be https)'] });
  });

  it('is on when everything is set (plain http only for this machine)', () => {
    const status = readCheckoutStatus(
      { ...on, KCPW_API_URL: 'https://shop.example.com/some/path?x=1' },
      false,
    );
    expect(status).toEqual({
      enabled: true,
      config: { apiUrl: 'https://shop.example.com', secret: SECRET },
    });
    expect(
      readCheckoutStatus({ ...on, KCPW_API_URL: 'http://127.0.0.1:3200' }, false).enabled,
    ).toBe(true);
    expect(
      readCheckoutStatus({ ...on, KCPW_API_URL: 'http://localhost:8080' }, false).enabled,
    ).toBe(true);
  });
});

/** What a production container needs, on top of the staging rules. SITE is what the image was built with (NEXT_PUBLIC_SITE_URL). */
describe('checkout in a production build', () => {
  const SITE = 'https://kcprintworks.com';
  const production = {
    CHECKOUT_ENABLED: 'true',
    CATALOG_SOURCE: 'woo',
    KCPW_API_URL: 'https://shop.kcprintworks.com',
    KCPW_HANDOFF_SECRET: SECRET,
  };
  const read = (env: Record<string, string | undefined>, site = SITE) =>
    readCheckoutStatus(env, true, site);

  it('is off by default in production, with or without the other settings', () => {
    expect(read({})).toEqual({ enabled: false, reason: 'not turned on' });
    expect(read({ ...production, CHECKOUT_ENABLED: undefined }).enabled).toBe(false);
    for (const value of ['', 'false', '1', 'yes', 'TRUE']) {
      expect(read({ ...production, CHECKOUT_ENABLED: value }).enabled, value).toBe(false);
    }
  });

  it('is on when CHECKOUT_ENABLED=true and everything is valid (https shop, https storefront, woo catalog, long secret)', () => {
    expect(read(production)).toEqual({
      enabled: true,
      config: { apiUrl: 'https://shop.kcprintworks.com', secret: SECRET },
    });
    // The shop address may come from the WooCommerce address, as on staging.
    expect(
      read({
        ...production,
        KCPW_API_URL: undefined,
        WC_BASE_URL: 'https://shop.kcprintworks.com/',
      }).enabled,
    ).toBe(true);
  });

  it('names a missing secret, a short secret and a missing shop address without echoing any value', () => {
    const none = read({ CHECKOUT_ENABLED: 'true', CATALOG_SOURCE: 'woo' });
    expect(none).toMatchObject({
      enabled: false,
      reason: 'not fully configured',
      missing: ['KCPW_API_URL', 'KCPW_HANDOFF_SECRET (32 or more characters)'],
    });
    const short = read({ ...production, KCPW_HANDOFF_SECRET: 'short-secret-value' });
    expect(short).toMatchObject({
      enabled: false,
      missing: ['KCPW_HANDOFF_SECRET (32 or more characters)'],
    });
    expect(JSON.stringify(short)).not.toContain('short-secret-value');
  });

  it('refuses a plain-http shop, including a local one (staging may test against localhost, production may not)', () => {
    for (const apiUrl of [
      'http://shop.kcprintworks.com',
      'http://localhost:3200',
      'http://127.0.0.1:3200',
      'https://localhost',
      'https://127.0.0.1',
    ]) {
      expect(read({ ...production, KCPW_API_URL: apiUrl }), apiUrl).toMatchObject({
        enabled: false,
        missing: ['KCPW_API_URL (must be https in production)'],
      });
    }
    expect(
      readCheckoutStatus({ ...production, KCPW_API_URL: 'http://127.0.0.1:3200' }, false, SITE)
        .enabled,
    ).toBe(true);
  });

  it('needs the build to carry an https, non-local storefront address, and says that it is a build setting', () => {
    for (const site of [
      'http://kcprintworks.com',
      'http://localhost:3000',
      'https://localhost:3000',
      'not a url',
      '',
      'https://kcprintworks.com/store',
    ]) {
      const status = read(production, site);
      expect(status, site).toMatchObject({ enabled: false });
      expect(JSON.stringify(status), site).toContain('NEXT_PUBLIC_SITE_URL');
    }
  });

  it('refuses a shop that is the storefront itself (a miswired KCPW_API_URL)', () => {
    expect(read({ ...production, KCPW_API_URL: 'https://kcprintworks.com' })).toMatchObject({
      enabled: false,
      missing: ['KCPW_API_URL (the shop must be a different host from the storefront)'],
    });
  });

  it('needs the live WooCommerce catalog so the cart is never priced from sample data', () => {
    for (const source of [undefined, '', 'fixtures', 'export']) {
      expect(read({ ...production, CATALOG_SOURCE: source }), String(source)).toMatchObject({
        enabled: false,
        missing: ['CATALOG_SOURCE (must be woo in production)'],
      });
    }
  });

  it('reports every problem at once', () => {
    const status = read(
      { CHECKOUT_ENABLED: 'true', KCPW_API_URL: 'http://shop.example.com' },
      'http://x',
    );
    expect(status).toMatchObject({ enabled: false });
    expect(status.enabled ? [] : status.missing).toHaveLength(4);
  });
});

describe('currentCheckoutStatus explains a button that will not enable', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  async function load(env: Record<string, string>) {
    for (const name of [
      'CHECKOUT_ENABLED',
      'KCPW_API_URL',
      'KCPW_SHOP_URL',
      'WC_BASE_URL',
      'KCPW_HANDOFF_SECRET',
    ]) {
      vi.stubEnv(name, env[name] ?? '');
    }
    vi.resetModules();
    return (await import('@/lib/checkout')).currentCheckoutStatus;
  }

  it('logs once, naming what is missing and never a value, when checkout was asked for but is incomplete', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const current = await load({ CHECKOUT_ENABLED: 'true', KCPW_HANDOFF_SECRET: 'tiny-secret' });
    expect(current().enabled).toBe(false);
    expect(current().enabled).toBe(false);
    expect(warn).toHaveBeenCalledOnce();
    const line = String(warn.mock.calls[0]![0]);
    expect(line).toContain('KCPW_API_URL');
    expect(line).toContain('KCPW_HANDOFF_SECRET');
    expect(line).not.toContain('tiny-secret');
  });

  it('stays quiet when checkout was never asked for, and when it is on', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect((await load({}))().enabled).toBe(false);
    expect(
      (
        await load({
          CHECKOUT_ENABLED: 'true',
          KCPW_SHOP_URL: 'https://shop.example.com',
          KCPW_HANDOFF_SECRET: SECRET,
        })
      )().enabled,
    ).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });
});
