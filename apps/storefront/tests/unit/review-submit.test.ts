import { describe, expect, it } from 'vitest';
import { clientAddress, clientKey } from '@/lib/reviews/client-key';
import {
  MAX_AGE_SECONDS,
  MIN_AGE_SECONDS,
  checkFormToken,
  issueFormToken,
} from '@/lib/reviews/form-token';
import { RateLimiter } from '@/lib/reviews/rate-limit';
import { readReviewSubmitStatus, type ReviewSubmitStatus } from '@/lib/reviews/submit-config';
import { handleReviewSubmission, sameSite } from '@/lib/reviews/submit-handler';

const SECRET = 'unit-test-secret-not-real-0123456789abcdef-xyz';
const HOST = 'staging.example.test';
const PRODUCT = 42;
const T0 = 1_800_000_000_000;

const enabled: ReviewSubmitStatus = {
  enabled: true,
  config: { apiUrl: 'https://shop.example.test', secret: SECRET },
};

describe('review submission settings', () => {
  const base = {
    REVIEWS_SUBMIT_ENABLED: 'true',
    WC_BASE_URL: 'https://shop.example.com',
    KCPW_HANDOFF_SECRET: SECRET,
  };
  it('is off unless deliberately switched on, and says what is missing', () => {
    expect(readReviewSubmitStatus({})).toEqual({ enabled: false, reason: 'not turned on' });
    expect(readReviewSubmitStatus({ ...base, REVIEWS_SUBMIT_ENABLED: 'yes' })).toMatchObject({
      enabled: false,
    });
    expect(readReviewSubmitStatus({ ...base, KCPW_HANDOFF_SECRET: 'short' })).toMatchObject({
      enabled: false,
      missing: ['KCPW_HANDOFF_SECRET (32 or more characters)'],
    });
    expect(
      readReviewSubmitStatus({ ...base, WC_BASE_URL: 'http://shop.example.com' }),
    ).toMatchObject({
      enabled: false,
      missing: ['WC_BASE_URL (must be https)'],
    });
  });
  it('uses the same shop address and secret as checkout', () => {
    expect(readReviewSubmitStatus(base)).toEqual({
      enabled: true,
      config: { apiUrl: 'https://shop.example.com', secret: SECRET },
    });
    expect(
      readReviewSubmitStatus({ ...base, KCPW_API_URL: 'http://127.0.0.1:3200' }),
    ).toMatchObject({
      enabled: true,
      config: { apiUrl: 'http://127.0.0.1:3200' },
    });
  });
});

describe('form token', () => {
  const token = issueFormToken(SECRET, PRODUCT, T0);
  it('is accepted a few seconds to two hours after it was issued', () => {
    expect(checkFormToken(SECRET, PRODUCT, token, T0 + MIN_AGE_SECONDS * 1000)).toBe('ok');
    expect(checkFormToken(SECRET, PRODUCT, token, T0 + 60_000)).toBe('ok');
    expect(checkFormToken(SECRET, PRODUCT, token, T0 + MAX_AGE_SECONDS * 1000)).toBe('ok');
  });
  it('is too fast before the minimum age and expired after the maximum', () => {
    expect(checkFormToken(SECRET, PRODUCT, token, T0 + 1000)).toBe('too_fast');
    expect(checkFormToken(SECRET, PRODUCT, token, T0 + (MAX_AGE_SECONDS + 1) * 1000)).toBe(
      'expired',
    );
  });
  it('is only good for the product and secret it was issued for, and is not forgeable', () => {
    expect(checkFormToken(SECRET, PRODUCT + 1, token, T0 + 60_000)).toBe('invalid');
    expect(
      checkFormToken('another-secret-of-enough-length-0123456789', PRODUCT, token, T0 + 60_000),
    ).toBe('invalid');
    const [issued, signature] = token.split('.');
    expect(
      checkFormToken(SECRET, PRODUCT, `${Number(issued) + 100}.${signature}`, T0 + 600_000),
    ).toBe('invalid');
    for (const bad of [
      undefined,
      null,
      5,
      '',
      'abc',
      `${issued}.`,
      `${issued}.${'0'.repeat(64)}`,
      `${'9'.repeat(13)}.${signature}`,
    ]) {
      expect(checkFormToken(SECRET, PRODUCT, bad, T0 + 60_000), String(bad)).toBe('invalid');
    }
    // A token from the future (a clock that jumped) is not accepted either.
    expect(checkFormToken(SECRET, PRODUCT, token, T0 - 60_000)).toBe('invalid');
  });
});

describe('rate limiter', () => {
  it('allows the limit, then refuses until the oldest attempt leaves the window', () => {
    let clock = 0;
    const limiter = new RateLimiter(3, 10_000, 100, () => clock);
    for (let n = 0; n < 3; n += 1) expect(limiter.hit('a')).toEqual({ allowed: true });
    expect(limiter.hit('a')).toEqual({ allowed: false, retryAfterSeconds: 10 });
    expect(limiter.hit('b')).toEqual({ allowed: true }); // another visitor is unaffected
    clock = 4_000;
    expect(limiter.hit('a')).toEqual({ allowed: false, retryAfterSeconds: 6 });
    clock = 10_001;
    expect(limiter.hit('a')).toEqual({ allowed: true });
  });
  it('remembers only so many visitors', () => {
    const limiter = new RateLimiter(1, 60_000, 50);
    for (let n = 0; n < 500; n += 1) limiter.hit(`ip-${n}`);
    expect(limiter.size()).toBe(50);
  });
});

describe('who is submitting', () => {
  it('trusts the proxy’s own observation, never what the client wrote', () => {
    expect(
      clientAddress(
        new Headers({ 'x-real-ip': '203.0.113.7', 'x-forwarded-for': '1.1.1.1, 2.2.2.2' }),
      ),
    ).toBe('203.0.113.7');
    expect(clientAddress(new Headers({ 'x-forwarded-for': '9.9.9.9 , 198.51.100.4' }))).toBe(
      '198.51.100.4',
    );
    expect(clientAddress(new Headers())).toBe('unknown');
  });
  it('turns an address into a keyed hash that does not contain it', () => {
    const key = clientKey(SECRET, '203.0.113.7');
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(key).toBe(clientKey(SECRET, '203.0.113.7'));
    expect(key).not.toBe(clientKey(SECRET, '203.0.113.8'));
    expect(key).not.toBe(clientKey('another-secret-of-enough-length-0123456789', '203.0.113.7'));
    expect(key).not.toContain('203');
  });
});

// ---- the whole request path, with the shop replaced by a function

const goodFields = {
  productId: PRODUCT,
  rating: 5,
  name: 'Robin Hood',
  email: 'robin@example.com',
  review: 'A really lovely case, it fits my cards perfectly.',
};

function setup(
  options: {
    products?: number[];
    upstream?: (url: string, init: RequestInit) => Response | Promise<Response>;
  } = {},
) {
  const calls: { url: string; init: RequestInit }[] = [];
  const logs: string[] = [];
  const fetchImpl = (async (url: URL | string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    return (
      (await options.upstream?.(String(url), init)) ??
      Response.json({ ok: true, status: 'received' }, { status: 200 })
    );
  }) as typeof fetch;
  const perClient = new RateLimiter(3, 600_000);
  const overall = new RateLimiter(60, 600_000);
  const accepted = new Set(options.products ?? [PRODUCT]);
  const deps = (status: ReviewSubmitStatus = enabled) => ({
    status,
    productAcceptsReviews: async (id: number) => accepted.has(id),
    perClient,
    overall,
    fetchImpl,
    now: () => T0 + 60_000,
    log: (line: string) => logs.push(line),
  });
  const post = (
    body: unknown,
    headers: Record<string, string> = {},
    token = issueFormToken(SECRET, PRODUCT, T0),
  ) =>
    new Request(`https://${HOST}/api/reviews/`, {
      method: 'POST',
      headers: {
        host: HOST,
        origin: `https://${HOST}`,
        'content-type': 'application/json',
        'x-real-ip': '203.0.113.7',
        ...headers,
      },
      body:
        typeof body === 'string'
          ? body
          : JSON.stringify({ ...(body as object), formToken: token, website: '' }),
    });
  return { calls, logs, deps, post };
}

describe('POST /api/reviews/: what is refused before the shop is asked', () => {
  it('does nothing when review submission is off', async () => {
    const t = setup();
    const reply = await handleReviewSubmission(
      t.post(goodFields),
      t.deps({ enabled: false, reason: 'not turned on' }),
    );
    expect(reply).toMatchObject({ status: 404, body: { ok: false, code: 'disabled' } });
    expect(t.calls).toHaveLength(0);
  });

  it('only accepts a form from this same site', () => {
    const t = setup();
    expect(sameSite(t.post(goodFields))).toBe(true);
    expect(sameSite(t.post(goodFields, { origin: 'https://evil.example' }))).toBe(false);
    expect(
      sameSite(new Request(`https://${HOST}/`, { method: 'POST', headers: { host: HOST } })),
    ).toBe(false);
    expect(
      sameSite(t.post(goodFields, { origin: '', referer: `https://${HOST}/product/x/` })),
    ).toBe(false); // empty origin counts as none
  });

  it('refuses another site, a wrong content type, and an oversized body', async () => {
    const t = setup();
    expect(
      (
        await handleReviewSubmission(
          t.post(goodFields, { origin: 'https://evil.example' }),
          t.deps(),
        )
      ).status,
    ).toBe(403);
    expect(
      (await handleReviewSubmission(t.post(goodFields, { 'content-type': 'text/plain' }), t.deps()))
        .status,
    ).toBe(415);
    const big = await handleReviewSubmission(
      t.post(JSON.stringify({ review: 'x'.repeat(20_000) })),
      t.deps(),
    );
    expect(big.status).toBe(413);
    expect(t.calls).toHaveLength(0);
  });

  it('refuses anything that is not a JSON object', async () => {
    const t = setup();
    for (const body of ['not json', '[]', '"text"', 'null', '5']) {
      expect((await handleReviewSubmission(t.post(body), t.deps())).status, body).toBe(400);
    }
    expect(t.calls).toHaveLength(0);
  });

  it('tells a robot everything went well and sends nothing when the hidden field is filled in', async () => {
    const t = setup();
    const request = t.post({ ...goodFields }, {}, issueFormToken(SECRET, PRODUCT, T0));
    const body = JSON.parse(await request.clone().text());
    const filled = new Request(request.url, {
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify({ ...body, website: 'http://spam.example' }),
    });
    expect(await handleReviewSubmission(filled, t.deps())).toMatchObject({
      status: 200,
      body: { ok: true },
    });
    expect(t.calls).toHaveLength(0);
  });

  it('refuses fields this form does not have, including any claim of approval or verification', async () => {
    const t = setup();
    for (const extra of [
      { verified: true },
      { approved: 1 },
      { status: 'approve' },
      { rating2: 5 },
    ]) {
      const reply = await handleReviewSubmission(t.post({ ...goodFields, ...extra }), t.deps());
      expect(reply.status, JSON.stringify(extra)).toBe(400);
      expect(reply.body).toMatchObject({ ok: false, code: 'form_expired' });
    }
    expect(t.calls).toHaveLength(0);
  });

  it('lists every field problem in plain words', async () => {
    const t = setup();
    const reply = await handleReviewSubmission(
      t.post({ productId: PRODUCT, rating: 9, name: 'x', email: 'nope', review: 'short' }),
      t.deps(),
    );
    expect(reply.status).toBe(400);
    expect(reply.body).toMatchObject({ ok: false, code: 'invalid' });
    const errors = (reply.body as { errors: { field: string; message: string }[] }).errors;
    expect(errors.map((e) => e.field)).toEqual(['rating', 'name', 'email', 'review']);
    expect(errors.every((e) => e.message.length > 5)).toBe(true);
    expect(t.calls).toHaveLength(0);
  });

  it('needs the token this server signed for this product, not too soon and not too late', async () => {
    const t = setup();
    expect((await handleReviewSubmission(t.post(goodFields, {}, 'forged'), t.deps())).status).toBe(
      400,
    );
    expect(
      (
        await handleReviewSubmission(
          t.post(goodFields, {}, issueFormToken(SECRET, 999, T0)),
          t.deps(),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await handleReviewSubmission(
          t.post(goodFields, {}, issueFormToken(SECRET, PRODUCT, T0 - 3 * 3600_000)),
          t.deps(),
        )
      ).body,
    ).toMatchObject({ code: 'form_expired' });
    const quick = await handleReviewSubmission(
      t.post(goodFields, {}, issueFormToken(SECRET, PRODUCT, T0 + 59_000)),
      t.deps(),
    );
    expect(quick).toMatchObject({ status: 429, body: { code: 'try_again' } });
    expect(t.calls).toHaveLength(0);
  });

  it('limits each visitor and the shop as a whole, with a Retry-After', async () => {
    const t = setup();
    for (let n = 0; n < 3; n += 1)
      expect((await handleReviewSubmission(t.post(goodFields), t.deps())).status).toBe(200);
    const limited = await handleReviewSubmission(t.post(goodFields), t.deps());
    expect(limited).toMatchObject({ status: 429, body: { code: 'rate_limited' } });
    expect(Number(limited.headers?.['Retry-After'])).toBeGreaterThan(0);
    expect(t.calls).toHaveLength(3);
    // another visitor still gets through
    expect(
      (await handleReviewSubmission(t.post(goodFields, { 'x-real-ip': '198.51.100.9' }), t.deps()))
        .status,
    ).toBe(200);
  });

  it('only accepts reviews for a product the shop lists with reviews on', async () => {
    const t = setup({ products: [] });
    expect(await handleReviewSubmission(t.post(goodFields), t.deps())).toMatchObject({
      status: 404,
      body: { code: 'closed' },
    });
    expect(t.calls).toHaveLength(0);
  });
});

describe('POST /api/reviews/: passing a good review to the shop', () => {
  it('sends only the review fields and an anonymous visitor key, signed, to the shop’s reviews route', async () => {
    const t = setup();
    const reply = await handleReviewSubmission(
      t.post({ ...goodFields, name: '  Robin   Hood ', email: 'Robin@Example.COM' }),
      t.deps(),
    );
    expect(reply).toMatchObject({ status: 200, body: { ok: true } });
    expect(t.calls).toHaveLength(1);
    const { url, init } = t.calls[0]!;
    expect(url).toBe('https://shop.example.test/wp-json/kcpw/v1/reviews');
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('error');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-kcpw-signature']).toMatch(/^[0-9a-f]{64}$/);
    const sent = JSON.parse(String(init.body));
    expect(Object.keys(sent).sort()).toEqual([
      'clientKey',
      'email',
      'name',
      'productId',
      'rating',
      'review',
    ]);
    expect(sent).toMatchObject({
      name: 'Robin Hood',
      email: 'robin@example.com',
      rating: 5,
      productId: PRODUCT,
    });
    expect(sent.clientKey).toBe(clientKey(SECRET, '203.0.113.7'));
    expect(JSON.stringify(sent)).not.toContain('203.0.113.7'); // the address itself is never sent
    expect(JSON.stringify(reply.body)).not.toContain('robin'); // and nothing about the shopper comes back
  });

  const outcomes: [string, number, unknown, number, string][] = [
    [
      'verified owners only',
      403,
      { ok: false, status: 'verification_required' },
      403,
      'verification_required',
    ],
    ['reviews closed', 403, { ok: false, status: 'reviews_closed' }, 403, 'closed'],
    ['product unknown to the shop', 404, { ok: false, status: 'product_not_found' }, 404, 'closed'],
    ['shop-side rate limit', 429, { ok: false, status: 'rate_limited' }, 429, 'rate_limited'],
    ['shop refuses the content', 400, { ok: false, status: 'invalid_request' }, 503, 'unavailable'],
    ['shop error', 500, { ok: false, status: 'server_error' }, 503, 'unavailable'],
    ['signature not accepted', 401, { code: 'kcpw_unauthorized' }, 503, 'unavailable'],
    ['plugin not set up', 503, { code: 'kcpw_not_configured' }, 503, 'unavailable'],
    ['plugin too old for reviews', 404, { code: 'rest_no_route' }, 503, 'unavailable'],
  ];
  it.each(outcomes)('%s', async (_label, upstreamStatus, upstreamBody, status, code) => {
    const t = setup({ upstream: () => Response.json(upstreamBody, { status: upstreamStatus }) });
    const reply = await handleReviewSubmission(t.post(goodFields), t.deps());
    expect(reply.status).toBe(status);
    expect(reply.body).toMatchObject({ ok: false, code });
    // The shop’s own words never reach the shopper, and nothing about them reaches the log.
    expect(JSON.stringify(reply.body)).not.toMatch(/kcpw_|rest_no_route|product_not_found/);
    expect(t.logs.join(' ')).not.toMatch(/robin|lovely|203\.0/i);
  });

  it('says so when the shop cannot be reached, without leaking why', async () => {
    const t = setup({
      upstream: () => Promise.reject(new TypeError('connect ECONNREFUSED 10.0.0.5:443')),
    });
    const reply = await handleReviewSubmission(t.post(goodFields), t.deps());
    expect(reply).toMatchObject({ status: 503, body: { ok: false, code: 'unavailable' } });
    expect(JSON.stringify(reply.body)).not.toContain('10.0.0.5');
    expect(t.logs.join(' ')).not.toContain('10.0.0.5');
  });

  it('does not treat a success-looking body with the wrong status as a saved review', async () => {
    const t = setup({
      upstream: () => Response.json({ ok: true, status: 'received' }, { status: 202 }),
    });
    expect((await handleReviewSubmission(t.post(goodFields), t.deps())).body).toMatchObject({
      ok: false,
      code: 'unavailable',
    });
  });
});
