import { describe, expect, it } from 'vitest';
import { checkShop } from '@/lib/handoff/shop-guard';

const config = { apiUrl: 'https://shop.kcprintworks.com', secret: 'x'.repeat(40) };

const base = {
  ok: true,
  plugin: '0.2.1',
  woocommerce: '9.9.9',
  currency: 'USD',
  storefrontUrlConfigured: true,
  stripeActive: true,
  stripeTestMode: true,
};
const shop = (fields: Record<string, unknown> = {}, status = 200): typeof fetch =>
  (async () =>
    new Response(JSON.stringify({ ...base, ...fields }), {
      status,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;

describe('a staging or development build only reaches a shop that reports Stripe TEST mode', () => {
  const staging = { production: false, siteUrl: 'https://dev.kcprintworks.com' };

  it('proceeds while Stripe is in test mode, and does not look at the return address', async () => {
    const result = await checkShop(
      config,
      staging,
      shop({ storefrontUrl: 'https://elsewhere.example' }),
    );
    expect(result).toMatchObject({ ok: true, returnAddress: 'not_checked' });
  });

  it('refuses once the shop is in LIVE mode (the shared shop going live must not turn staging into a way to charge cards)', async () => {
    const result = await checkShop(config, staging, shop({ stripeTestMode: false }));
    expect(result).toMatchObject({ ok: false, kind: 'live_mode_blocked' });
    expect(JSON.stringify(result)).toContain('LIVE');
  });

  it('fails closed when the mode is unknown: no Stripe gateway, or a plugin that does not say', async () => {
    expect(
      await checkShop(config, staging, shop({ stripeTestMode: null, stripeActive: false })),
    ).toMatchObject({
      ok: false,
      kind: 'live_mode_blocked',
    });
    // A plugin that omits the mode entirely is not a valid status answer: unreachable, which is a refusal too.
    const silent = (async () =>
      new Response(JSON.stringify({ ok: true, plugin: '0.1.0' }))) as typeof fetch;
    expect(await checkShop(config, staging, silent)).toMatchObject({
      ok: false,
      kind: 'unreachable',
    });
  });

  it('refuses when the shop cannot be asked or does not accept the signature', async () => {
    const down = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    expect(await checkShop(config, staging, down)).toMatchObject({
      ok: false,
      kind: 'unreachable',
    });
    expect(await checkShop(config, staging, shop({}, 401))).toMatchObject({
      ok: false,
      kind: 'unreachable',
      why: expect.stringContaining('signature'),
    });
  });
});

describe('a production build only reaches a shop that returns shoppers to this storefront', () => {
  const production = { production: true, siteUrl: 'https://kcprintworks.com' };

  it('proceeds when the shop reports this storefront (trailing slash and path are ignored)', async () => {
    for (const storefrontUrl of ['https://kcprintworks.com', 'https://kcprintworks.com/']) {
      expect(
        await checkShop(config, production, shop({ storefrontUrl })),
        storefrontUrl,
      ).toMatchObject({
        ok: true,
        returnAddress: 'matches',
      });
    }
  });

  it('refuses a shop that still returns shoppers to staging (or anywhere else)', async () => {
    for (const storefrontUrl of [
      'https://dev.kcprintworks.com',
      'http://kcprintworks.com',
      'https://www.kcprintworks.com',
      'garbage',
    ]) {
      const result = await checkShop(config, production, shop({ storefrontUrl }));
      expect(result, storefrontUrl).toMatchObject({ ok: false, kind: 'return_address_mismatch' });
    }
  });

  it('proceeds, flagged, when the shop does not report an address (plugin 0.2.0, or the setting is empty)', async () => {
    expect(await checkShop(config, production, shop())).toMatchObject({
      ok: true,
      returnAddress: 'not_reported',
    });
    expect(
      await checkShop(
        config,
        production,
        shop({ storefrontUrl: null, storefrontUrlConfigured: false }),
      ),
    ).toMatchObject({ ok: true, returnAddress: 'not_reported' });
  });

  it('does not require test mode: a shop in LIVE mode is exactly what production is for', async () => {
    expect(
      await checkShop(
        config,
        production,
        shop({ stripeTestMode: false, storefrontUrl: 'https://kcprintworks.com' }),
      ),
    ).toMatchObject({ ok: true });
  });

  it('refuses when the shop cannot be asked', async () => {
    expect(await checkShop(config, production, shop({}, 503))).toMatchObject({
      ok: false,
      kind: 'unreachable',
    });
  });
});
