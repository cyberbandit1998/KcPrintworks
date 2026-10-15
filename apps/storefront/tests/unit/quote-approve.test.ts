import { describe, expect, it, vi } from 'vitest';
import { RateLimiter } from '@/lib/reviews/rate-limit';
import { handleQuoteApproval, type ApproveDeps } from '@/lib/quotes/approve-handler';
import { QUOTE_REF, QUOTE_TOKEN } from '@/lib/quotes/api-types';
import { currentQuotePaymentStatus } from '@/lib/quotes/config';
import { countryOptions } from '@/lib/quotes/countries';
import { safePayUrl } from '@/lib/quotes/pay-url';
import { fetchQuoteView, wellFormedLink } from '@/lib/quotes/view';

const SECRET = 'unit-test-secret-not-real-0123456789abcdef-xyz';
const SHOP = 'https://shop.example.test';
const REF = 'KCQ-2610-ABCDEF';
const TOKEN = 'A'.repeat(43);
const PAY = `${SHOP}/checkout/order-pay/812/?pay_for_order=true&key=wc_order_abc`;

const config = { apiUrl: SHOP, secret: SECRET };
const shopStatus = (stripeTestMode: boolean) => ({
  ok: true as const,
  plugin: '0.2.1',
  woocommerce: '9.9.9',
  currency: 'USD',
  storefrontUrlConfigured: true,
  stripeActive: true,
  stripeTestMode,
});
const goodShop = {
  ok: true as const,
  status: shopStatus(true),
  returnAddress: 'not_checked' as const,
};

const approval = (over: Record<string, unknown> = {}) => ({
  revision: 1,
  line1: '12 Main Street',
  line2: '',
  city: 'Flint',
  state: 'MI',
  postcode: '48503',
  country: 'US',
  phone: '',
  accepted: true,
  ...over,
});

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('https://staging.example.test/api/quotes/approve/', {
    method: 'POST',
    headers: {
      host: 'staging.example.test',
      origin: 'https://staging.example.test',
      'content-type': 'application/json',
      'x-real-ip': '203.0.113.9',
      ...headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

function deps(over: Partial<ApproveDeps> = {}): {
  deps: ApproveDeps;
  calls: { url: string; body: string; headers: Headers }[];
} {
  const calls: { url: string; body: string; headers: Headers }[] = [];
  return {
    calls,
    deps: {
      status: { enabled: true, config },
      perClient: new RateLimiter(20, 60_000),
      overall: new RateLimiter(200, 60_000),
      guard: { production: false, siteUrl: 'https://staging.example.test' },
      shopCheck: async () => goodShop,
      fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({
          url: String(url),
          body: String(init?.body),
          headers: new Headers(init?.headers),
        });
        return new Response(JSON.stringify({ ok: true, status: 'approved', payUrl: PAY }), {
          status: 200,
        });
      }) as typeof fetch,
      log: () => undefined,
      ...over,
    },
  };
}

const answerWith = (status: number, json: unknown): typeof fetch =>
  (async () => new Response(JSON.stringify(json), { status })) as typeof fetch;

describe('the payment address the shop hands back', () => {
  it('accepts the shop’s own "Pay for order" page, pretty or plain permalinks', () => {
    expect(safePayUrl(PAY, SHOP)).toBe(PAY);
    expect(safePayUrl(`${SHOP}/checkout/order-pay/812/`, SHOP)).toBeTruthy();
    expect(
      safePayUrl(`${SHOP}/?order-pay=812&pay_for_order=true&key=wc_order_abc`, SHOP),
    ).toBeTruthy();
    expect(
      safePayUrl('http://127.0.0.1:3200/checkout/order-pay/5/', 'http://127.0.0.1:3200'),
    ).toBeTruthy();
  });
  it('refuses anything else: another host, plain http, credentials, a fragment, the wrong page, junk', () => {
    for (const bad of [
      'https://evil.example/checkout/order-pay/812/',
      `${SHOP}.evil.example/checkout/order-pay/812/`,
      'https://shop.example.test@evil.example/checkout/order-pay/812/',
      'https://user:pw@shop.example.test/checkout/order-pay/812/',
      'http://shop.example.test/checkout/order-pay/812/',
      `${SHOP}/checkout/order-pay/812/#x`,
      `${SHOP}/wp-admin/?x=order-pay`,
      `${SHOP}/checkout/order-pay/abc/`,
      `${SHOP}/checkout/`,
      `${SHOP}/?order-pay=abc`,
      'javascript:alert(1)',
      '//evil.example/checkout/order-pay/1/',
      '',
      undefined,
      null,
      42,
      'x'.repeat(700),
    ]) {
      expect(safePayUrl(bad, SHOP), String(bad)).toBeUndefined();
    }
  });
});

describe('looking at a quote link', () => {
  const good = {
    ok: true,
    state: 'open',
    ref: REF,
    firstName: 'Robin',
    project: 'Game case or box',
    quantity: 2,
    title: 'Custom case for Catan',
    details: 'Black body.',
    itemCents: 4500,
    shipCents: 850,
    totalCents: 5350,
    currency: 'USD',
    taxable: false,
    revision: 1,
    expiresAt: 1_900_000_000,
    payBy: 0,
  };
  it('only bothers the shop when the reference and token look right', async () => {
    expect(wellFormedLink(REF, TOKEN)).toBe(true);
    expect(QUOTE_REF.test('KCQ-2610-AB0DEF')).toBe(false); // 0 and 1 and I and O are never used
    expect(QUOTE_TOKEN.test('A'.repeat(42))).toBe(false);
    const fetchImpl = vi.fn();
    for (const [ref, token] of [
      ['junk', TOKEN],
      [REF, 'short'],
      [REF, `${TOKEN}x`],
      ['', ''],
    ] as const) {
      expect(
        await fetchQuoteView(config, ref, token, fetchImpl as unknown as typeof fetch),
      ).toEqual({ kind: 'invalid_link' });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('signs the call and shows what comes back, nothing more', async () => {
    let seen: { url: string; body: string; headers: Headers } | undefined;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen = { url, body: String(init.body), headers: new Headers(init.headers) };
      return new Response(
        JSON.stringify({
          ...good,
          email: 'robin@example.com',
          description: 'secret',
          payUrl: PAY,
          state: 'approved',
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    const result = await fetchQuoteView(config, REF, TOKEN, fetchImpl);
    expect(String(seen?.url)).toBe(`${SHOP}/wp-json/kcpw-quotes/v1/quote/view`);
    expect(JSON.parse(seen!.body)).toEqual({ ref: REF, token: TOKEN });
    expect(seen!.headers.get('x-kcpw-signature')).toMatch(/^[0-9a-f]{64}$/);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.view.state).toBe('approved');
    expect(result.view.payUrl).toBe(PAY);
    expect(JSON.stringify(result.view)).not.toMatch(/robin@example|secret|"ok"/);
  });
  it('drops a payment address that is not the shop’s, and keeps the rest', async () => {
    const result = await fetchQuoteView(
      config,
      REF,
      TOKEN,
      answerWith(200, {
        ...good,
        state: 'approved',
        payUrl: 'https://evil.example/checkout/order-pay/1/',
      }),
    );
    expect(result.kind === 'ok' && result.view.payUrl).toBeFalsy();
    expect(result.kind).toBe('ok');
  });
  it('treats a wrong link as a wrong link, and anything odd as unavailable', async () => {
    expect(
      await fetchQuoteView(
        config,
        REF,
        TOKEN,
        answerWith(404, { ok: false, status: 'invalid_link' }),
      ),
    ).toEqual({ kind: 'invalid_link' });
    const logged: string[] = [];
    for (const [status, json] of [
      [200, { ...good, totalCents: 'free' }],
      [200, { ...good, state: 'hacked' }],
      [200, { ...good, ref: 'nope' }],
      [200, { ok: true }],
      [500, { ok: false }],
      [401, { code: 'kcpw_unauthorized' }],
      [503, { code: 'kcpw_not_ready' }],
    ] as const) {
      expect(
        await fetchQuoteView(config, REF, TOKEN, answerWith(status, json), (l) => logged.push(l)),
        `${status} ${JSON.stringify(json).slice(0, 40)}`,
      ).toEqual({ kind: 'unavailable' });
    }
    const down = (async () => {
      throw new Error('network');
    }) as unknown as typeof fetch;
    expect(await fetchQuoteView(config, REF, TOKEN, down, (l) => logged.push(l))).toEqual({
      kind: 'unavailable',
    });
    expect(logged.length).toBeGreaterThan(5);
    expect(logged.join('\n')).not.toContain(SECRET);
    expect(logged.join('\n')).not.toContain(TOKEN);
  });
});

describe('approving a quote', () => {
  const body = (over: Record<string, unknown> = {}) => ({
    ref: REF,
    token: TOKEN,
    approval: approval(),
    ...over,
  });

  it('sends the validated approval to the shop, signed, and returns the checked payment address', async () => {
    const { deps: d, calls } = deps();
    const reply = await handleQuoteApproval(post(body()), d);
    expect(reply).toEqual({ status: 200, body: { ok: true, payUrl: PAY } });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`${SHOP}/wp-json/kcpw-quotes/v1/quote/approve`);
    expect(calls[0]!.headers.get('x-kcpw-signature')).toMatch(/^[0-9a-f]{64}$/);
    const sent = JSON.parse(calls[0]!.body);
    expect(Object.keys(sent).sort()).toEqual(['approval', 'ref', 'token']);
    expect(Object.keys(sent.approval).sort()).toEqual([
      'accepted',
      'city',
      'country',
      'line1',
      'line2',
      'phone',
      'postcode',
      'revision',
      'state',
    ]);
    expect(calls[0]!.body).not.toMatch(/price|total|amount|cents/i);
  });

  it('does nothing unless payments are switched on', async () => {
    const { deps: d, calls } = deps({
      status: { enabled: false, reason: 'checkout is not turned on' },
    });
    const reply = await handleQuoteApproval(post(body()), d);
    expect(reply.status).toBe(403);
    expect(reply.body).toMatchObject({ ok: false, code: 'disabled' });
    expect(calls).toHaveLength(0);
  });

  it('needs both quotes and checkout to be on', () => {
    const saved = { ...process.env };
    try {
      for (const name of ['QUOTES_ENABLED', 'CHECKOUT_ENABLED', 'KCPW_API_URL', 'KCPW_SHOP_URL'])
        delete process.env[name];
      process.env.WC_BASE_URL = SHOP;
      process.env.KCPW_HANDOFF_SECRET = SECRET;
      expect(currentQuotePaymentStatus()).toMatchObject({ enabled: false });
      process.env.QUOTES_ENABLED = 'true';
      expect(currentQuotePaymentStatus()).toMatchObject({
        enabled: false,
        reason: 'checkout is not turned on',
      });
      process.env.CHECKOUT_ENABLED = 'true';
      expect(currentQuotePaymentStatus()).toMatchObject({ enabled: true });
      delete process.env.QUOTES_ENABLED;
      expect(currentQuotePaymentStatus()).toMatchObject({
        enabled: false,
        reason: 'quotes are not turned on',
      });
    } finally {
      for (const name of Object.keys(process.env)) if (!(name in saved)) delete process.env[name];
      Object.assign(process.env, saved);
    }
  });

  it('refuses other sites, other content types and big or broken bodies', async () => {
    const { deps: d, calls } = deps();
    expect(
      (await handleQuoteApproval(post(body(), { origin: 'https://evil.example' }), d)).status,
    ).toBe(403);
    expect((await handleQuoteApproval(post(body(), { origin: '', referer: '' }), d)).status).toBe(
      403,
    );
    expect(
      (await handleQuoteApproval(post(body(), { 'content-type': 'text/plain' }), d)).status,
    ).toBe(415);
    expect((await handleQuoteApproval(post('{not json'), d)).status).toBe(400);
    expect((await handleQuoteApproval(post('[]'), d)).status).toBe(400);
    expect((await handleQuoteApproval(post('x'.repeat(7000)), d)).status).toBe(413);
    expect(calls).toHaveLength(0);
  });

  it('refuses a price, a total or anything else that is not exactly the known fields', async () => {
    const { deps: d, calls } = deps();
    for (const extra of [
      { price: 1 },
      { total: 5 },
      { itemCents: 100 },
      { status: 'paid' },
      { orderId: 4 },
    ]) {
      const inApproval = await handleQuoteApproval(post(body({ approval: approval(extra) })), d);
      expect(inApproval.body, JSON.stringify(extra)).toMatchObject({
        ok: false,
        code: 'form_expired',
      });
      const outside = await handleQuoteApproval(post({ ...body(), ...extra }), d);
      expect(outside.body, JSON.stringify(extra)).toMatchObject({
        ok: false,
        code: 'form_expired',
      });
    }
    expect((await handleQuoteApproval(post({ ref: REF, token: TOKEN }), d)).status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('answers a malformed link as an invalid link without asking the shop', async () => {
    const { deps: d, calls } = deps();
    expect((await handleQuoteApproval(post(body({ ref: 'junk' })), d)).body).toMatchObject({
      code: 'invalid_link',
    });
    expect((await handleQuoteApproval(post(body({ token: 'short' })), d)).status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it('returns the field problems for an incomplete approval', async () => {
    const { deps: d, calls } = deps();
    const reply = await handleQuoteApproval(
      post(body({ approval: approval({ line1: '', accepted: false, postcode: '!!' }) })),
      d,
    );
    expect(reply.status).toBe(400);
    expect(reply.body).toMatchObject({ ok: false, code: 'invalid' });
    const fields =
      reply.body.ok === false && reply.body.code === 'invalid'
        ? reply.body.errors.map((e) => e.field)
        : [];
    expect(fields).toEqual(['line1', 'postcode', 'accepted']);
    expect(calls).toHaveLength(0);
  });

  it('limits attempts per visitor and overall', async () => {
    const { deps: d } = deps({
      perClient: new RateLimiter(2, 60_000),
      overall: new RateLimiter(200, 60_000),
    });
    expect((await handleQuoteApproval(post(body()), d)).status).toBe(200);
    expect((await handleQuoteApproval(post(body()), d)).status).toBe(200);
    const limited = await handleQuoteApproval(post(body()), d);
    expect(limited.status).toBe(429);
    expect(limited.headers?.['Retry-After']).toMatch(/^\d+$/);
    expect(
      (await handleQuoteApproval(post(body(), { 'x-real-ip': '198.51.100.7' }), d)).status,
    ).toBe(200);
  });

  it('does not reach the shop when the shop says it is not in a state to take this payment', async () => {
    const logged: string[] = [];
    const { deps: d, calls } = deps({
      shopCheck: async () => ({
        ok: false,
        kind: 'live_mode_blocked',
        why: 'this is not a production build and the shop reports Stripe in LIVE mode',
        status: shopStatus(false),
      }),
      log: (l) => logged.push(l),
    });
    const reply = await handleQuoteApproval(post(body()), d);
    expect(reply.status).toBe(403);
    expect(reply.body).toMatchObject({ code: 'disabled' });
    expect(calls).toHaveLength(0);
    expect(logged[0]).toContain('live_mode_blocked');
    const down = deps({
      shopCheck: async () => ({ ok: false, kind: 'unreachable', why: 'timeout' }),
    });
    expect((await handleQuoteApproval(post(body()), down.deps)).status).toBe(503);
  });

  it('maps each answer of the shop to a clear message and never shows internals', async () => {
    const cases: [number, unknown, number, string][] = [
      [404, { ok: false, status: 'invalid_link' }, 404, 'invalid_link'],
      [409, { ok: false, status: 'terms_changed' }, 409, 'terms_changed'],
      [410, { ok: false, status: 'expired' }, 410, 'expired'],
      [409, { ok: false, status: 'not_open' }, 409, 'not_open'],
      [409, { ok: false, status: 'not_payable' }, 409, 'not_open'],
      [409, { ok: false, status: 'busy' }, 409, 'busy'],
      [
        400,
        { ok: false, status: 'invalid_request', problems: [{ field: 'x' }] },
        400,
        'form_expired',
      ],
      [503, { ok: false, status: 'unavailable' }, 503, 'unavailable'],
      [500, { ok: false, status: 'server_error' }, 503, 'unavailable'],
      [401, { code: 'kcpw_unauthorized' }, 503, 'unavailable'],
    ];
    for (const [shopStatus, json, status, code] of cases) {
      const { deps: d } = deps({ fetchImpl: answerWith(shopStatus, json) });
      const reply = await handleQuoteApproval(post(body()), d);
      expect(reply.status, code).toBe(status);
      expect(reply.body, code).toMatchObject({ ok: false, code });
      const text = JSON.stringify(reply.body);
      expect(text).not.toContain(SECRET);
      expect(text).not.toMatch(/kcpw|wp-json|stripe|order_id|exception|sql/i);
    }
  });

  it('never sends the shopper to a payment address it has not checked', async () => {
    const logged: string[] = [];
    for (const payUrl of [
      'https://evil.example/checkout/order-pay/1/',
      `${SHOP}/wp-admin/`,
      'javascript:alert(1)',
      undefined,
      7,
    ]) {
      const { deps: d } = deps({
        fetchImpl: answerWith(200, { ok: true, status: 'approved', payUrl }),
        log: (l) => logged.push(l),
      });
      const reply = await handleQuoteApproval(post(body()), d);
      expect(reply.body, String(payUrl)).toMatchObject({ ok: false, code: 'unavailable' });
    }
    expect(logged).toHaveLength(5);
  });

  it('survives the shop being unreachable', async () => {
    const { deps: d } = deps({
      fetchImpl: (async () => {
        throw new Error('ECONNREFUSED');
      }) as unknown as typeof fetch,
    });
    const reply = await handleQuoteApproval(post(body()), d);
    expect(reply.status).toBe(503);
    expect(reply.body).toMatchObject({ code: 'unavailable' });
  });
});

describe('the country list', () => {
  it('starts with the usual destinations, has names, and every code is two letters', () => {
    const list = countryOptions('en');
    expect(list.slice(0, 4).map((c) => c.code)).toEqual(['US', 'CA', 'GB', 'AU']);
    expect(list[0]!.name).toBe('United States');
    expect(list.every((c) => /^[A-Z]{2}$/.test(c.code) && c.name.length > 1)).toBe(true);
    expect(new Set(list.map((c) => c.code)).size).toBe(list.length);
    expect(list.length).toBeGreaterThan(200);
  });
});
