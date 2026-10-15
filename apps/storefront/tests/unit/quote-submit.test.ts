import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { checkFormToken, issueFormToken } from '@/lib/reviews/form-token';
import { RateLimiter } from '@/lib/reviews/rate-limit';
import { readQuotesStatus, todayInShop, type QuotesStatus } from '@/lib/quotes/config';
import {
  MAX_AGE_SECONDS,
  MIN_AGE_SECONDS,
  checkQuoteFormToken,
  issueQuoteFormToken,
} from '@/lib/quotes/form-token';
import { UPLOAD_LIMITS, detectImageKind, prepareUploads, safeFileName } from '@/lib/quotes/uploads';
import { MAX_BODY_BYTES, handleQuoteSubmission } from '@/lib/quotes/submit-handler';

const SECRET = 'unit-test-secret-not-real-0123456789abcdef-xyz';
const HOST = 'staging.example.test';
const T0 = 1_800_000_000_000; // 2027-01-15

const enabled: QuotesStatus = {
  enabled: true,
  config: { apiUrl: 'https://shop.example.test', secret: SECRET },
};

// ---- picture bytes (real file signatures, not real pictures)
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
const WEBP = Uint8Array.from([
  0x52, 0x49, 0x46, 0x46, 1, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50,
]);
const GIF = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0]);
const text = (s: string) => new TextEncoder().encode(s);

describe('quote settings', () => {
  const base = {
    QUOTES_ENABLED: 'true',
    WC_BASE_URL: 'https://shop.example.com',
    KCPW_HANDOFF_SECRET: SECRET,
  };
  it('is off unless deliberately switched on, and says what is missing', () => {
    expect(readQuotesStatus({})).toEqual({ enabled: false, reason: 'not turned on' });
    expect(readQuotesStatus({ ...base, QUOTES_ENABLED: 'yes' })).toMatchObject({ enabled: false });
    expect(readQuotesStatus({ ...base, KCPW_HANDOFF_SECRET: 'short' })).toMatchObject({
      enabled: false,
      missing: ['KCPW_HANDOFF_SECRET (32 or more characters)'],
    });
    expect(readQuotesStatus({ ...base, WC_BASE_URL: 'http://shop.example.com' })).toMatchObject({
      enabled: false,
      missing: ['WC_BASE_URL (must be https)'],
    });
  });
  it('uses the same shop address and secret as checkout and reviews', () => {
    expect(readQuotesStatus(base)).toEqual({
      enabled: true,
      config: { apiUrl: 'https://shop.example.com', secret: SECRET },
    });
  });
  it('works out "today" in the shop’s time zone, not the server’s', () => {
    const lateEvening = new Date('2027-01-16T02:30:00Z'); // still the 15th in Michigan
    expect(todayInShop(lateEvening, 'America/Detroit')).toBe('2027-01-15');
    expect(todayInShop(lateEvening, 'UTC')).toBe('2027-01-16');
    expect(todayInShop(lateEvening, 'Not/AZone')).toBe('2027-01-16');
  });
});

describe('quote form token', () => {
  const token = issueQuoteFormToken(SECRET, T0);
  it('is accepted a few seconds to four hours after it was issued', () => {
    expect(checkQuoteFormToken(SECRET, token, T0 + MIN_AGE_SECONDS * 1000)).toBe('ok');
    expect(checkQuoteFormToken(SECRET, token, T0 + MAX_AGE_SECONDS * 1000)).toBe('ok');
  });
  it('is too fast before the minimum age and expired after the maximum', () => {
    expect(checkQuoteFormToken(SECRET, token, T0 + 1000)).toBe('too_fast');
    expect(checkQuoteFormToken(SECRET, token, T0 + (MAX_AGE_SECONDS + 1) * 1000)).toBe('expired');
  });
  it('is not forgeable, and a review token is not a quote token (or the other way round)', () => {
    const [issued, signature] = token.split('.');
    expect(
      checkQuoteFormToken('another-secret-of-enough-length-0123456789', token, T0 + 60_000),
    ).toBe('invalid');
    expect(checkQuoteFormToken(SECRET, `${Number(issued) + 100}.${signature}`, T0 + 600_000)).toBe(
      'invalid',
    );
    for (const bad of [
      undefined,
      null,
      5,
      '',
      'abc',
      `${issued}.`,
      `${issued}.${'0'.repeat(64)}`,
    ]) {
      expect(checkQuoteFormToken(SECRET, bad, T0 + 60_000), String(bad)).toBe('invalid');
    }
    expect(checkQuoteFormToken(SECRET, issueFormToken(SECRET, 0, T0), T0 + 60_000)).toBe('invalid');
    expect(checkFormToken(SECRET, 0, token, T0 + 60_000)).toBe('invalid');
    expect(checkQuoteFormToken(SECRET, token, T0 - 60_000)).toBe('invalid');
  });
});

describe('pictures', () => {
  it('are recognised by their bytes, whatever they are called', () => {
    expect(detectImageKind(JPEG)).toBe('jpeg');
    expect(detectImageKind(PNG)).toBe('png');
    expect(detectImageKind(WEBP)).toBe('webp');
    expect(detectImageKind(GIF)).toBe('gif');
    for (const not of [
      text('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
      text('%PDF-1.7'),
      text('<html><script>alert(1)</script>'),
      text('MZ\u0090\u0000'),
      text('<?php system($_GET[1]); ?>'),
      Uint8Array.from([0x52, 0x49, 0x46, 0x46, 1, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]), // WAV, not WebP
      Uint8Array.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]), // HEIC
      new Uint8Array(0),
      Uint8Array.from([0xff, 0xd8]),
    ]) {
      expect(detectImageKind(not)).toBeNull();
    }
  });

  it('get a plain, safe name with the extension of what they really are', () => {
    expect(safeFileName('../../etc/passwd.png', 'jpeg')).toBe('passwd.jpg');
    expect(safeFileName('C:\\Users\\me\\Pictures\\case photo (1).PNG', 'png')).toBe(
      'case photo (1).png',
    );
    expect(safeFileName('x\u0000.php.jpg', 'jpeg')).toBe('x.php.jpg');
    expect(safeFileName('<script>alert(1)</script>.gif', 'gif')).toBe('script.gif');
    expect(safeFileName('', 'webp')).toBe('reference.webp');
    expect(safeFileName('Ünïcode Ñame.jpeg', 'jpeg')).toBe('Unicode Name.jpg');
    expect(safeFileName('a'.repeat(300) + '.png', 'png').length).toBeLessThanOrEqual(54);
    expect(safeFileName('...', 'png')).toBe('reference.png');
  });

  const file = (name: string, bytes: Uint8Array) => ({
    name,
    size: bytes.byteLength,
    arrayBuffer: async () =>
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  });

  it('are accepted when they are few, small and real, and sent as base64 with their real type', async () => {
    const out = await prepareUploads([file('a.png', JPEG), file('b.jpg', PNG)]);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.files.map((f) => f.type)).toEqual(['image/jpeg', 'image/png']);
      expect(out.files.map((f) => f.name)).toEqual(['a.jpg', 'b.png']); // renamed to what they are
      expect(Buffer.from(out.files[0]!.data, 'base64')).toEqual(Buffer.from(JPEG));
    }
  });
  it('are refused when there are too many, one is too big, together they are too big, or one is not a picture', async () => {
    const many = Array.from({ length: UPLOAD_LIMITS.maxFiles + 1 }, (_, i) =>
      file(`${i}.jpg`, JPEG),
    );
    expect(await prepareUploads(many)).toMatchObject({ ok: false, problem: { code: 'too_many' } });
    const big = new Uint8Array(UPLOAD_LIMITS.maxFileBytes + 1);
    big.set(JPEG);
    expect(await prepareUploads([file('big.jpg', big)])).toMatchObject({
      ok: false,
      problem: { code: 'too_large' },
    });
    const mid = new Uint8Array(UPLOAD_LIMITS.maxFileBytes);
    mid.set(JPEG);
    expect(
      await prepareUploads([file('1.jpg', mid), file('2.jpg', mid), file('3.jpg', mid)]),
    ).toMatchObject({
      ok: false,
      problem: { code: 'too_large' },
    });
    expect(await prepareUploads([file('x.svg', text('<svg onload=alert(1)>'))])).toMatchObject({
      ok: false,
      problem: { code: 'bad_type', name: 'x.svg' },
    });
    // A size that lies is caught by the real byte count.
    const liar = { name: 'liar.jpg', size: 10, arrayBuffer: async () => big.buffer as ArrayBuffer };
    expect(await prepareUploads([liar])).toMatchObject({
      ok: false,
      problem: { code: 'too_large' },
    });
  });
});

// ---- the whole request path, with the shop replaced by a function

const good = {
  name: 'Robin Hood',
  email: 'robin@example.com',
  projectType: 'game-case',
  game: 'Catan',
  description: 'A case for the base game and both expansions, with room for the sleeves.',
  dimensions: '12 x 12 x 4 in',
  quantity: '2',
  colors: 'Forest green',
  deadline: '2027-03-01',
  shipTo: 'US 48503',
};

function setup(upstream?: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const logs: string[] = [];
  const fetchImpl = (async (url: URL | string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    return (
      (await upstream?.(String(url), init)) ??
      Response.json({ ok: true, status: 'received', ref: 'KCQ-2701-ABCD23' }, { status: 200 })
    );
  }) as typeof fetch;
  const perClient = new RateLimiter(4, 3_600_000);
  const overall = new RateLimiter(60, 3_600_000);
  const deps = (status: QuotesStatus = enabled) => ({
    status,
    perClient,
    overall,
    fetchImpl,
    now: () => T0 + 60_000,
    log: (line: string) => logs.push(line),
  });
  const post = (
    fields: Record<string, string | undefined> = {},
    files: { name: string; bytes: Uint8Array }[] = [],
    headers: Record<string, string> = {},
    token = issueQuoteFormToken(SECRET, T0),
  ) => {
    const form = new FormData();
    for (const [k, v] of Object.entries({ ...good, formToken: token, website: '', ...fields })) {
      if (v !== undefined) form.append(k, v);
    }
    for (const f of files) form.append('files', new File([new Uint8Array(f.bytes)], f.name));
    return new Request(`https://${HOST}/api/quotes/`, {
      method: 'POST',
      headers: { host: HOST, origin: `https://${HOST}`, 'x-real-ip': '203.0.113.7', ...headers },
      body: form,
    });
  };
  return { calls, logs, deps, post };
}

describe('POST /api/quotes/: what is refused before the shop is asked', () => {
  it('does nothing when quotes are off', async () => {
    const t = setup();
    const reply = await handleQuoteSubmission(
      t.post(),
      t.deps({ enabled: false, reason: 'not turned on' }),
    );
    expect(reply.status).toBe(404);
    expect(t.calls).toHaveLength(0);
  });

  it('refuses another site, and anything that is not a multipart form', async () => {
    const t = setup();
    const other = await handleQuoteSubmission(
      t.post({}, [], { origin: 'https://evil.example' }),
      t.deps(),
    );
    expect(other.status).toBe(403);
    const noOrigin = new Request(`https://${HOST}/api/quotes/`, {
      method: 'POST',
      headers: { host: HOST },
      body: new FormData(),
    });
    expect((await handleQuoteSubmission(noOrigin, t.deps())).status).toBe(403);
    const json = new Request(`https://${HOST}/api/quotes/`, {
      method: 'POST',
      headers: { host: HOST, origin: `https://${HOST}`, 'content-type': 'application/json' },
      body: JSON.stringify(good),
    });
    expect((await handleQuoteSubmission(json, t.deps())).status).toBe(415);
    expect(t.calls).toHaveLength(0);
  });

  it('refuses a body that is too large, even when it does not say how large it is', async () => {
    const t = setup();
    const huge = new Request(`https://${HOST}/api/quotes/`, {
      method: 'POST',
      headers: {
        host: HOST,
        origin: `https://${HOST}`,
        'content-type': 'multipart/form-data; boundary=x',
      },
      body: new Uint8Array(MAX_BODY_BYTES + 10),
    });
    const reply = await handleQuoteSubmission(huge, t.deps());
    expect(reply.status).toBe(413);
    expect(reply.body).toMatchObject({ ok: false, code: 'too_large' });
    expect(t.calls).toHaveLength(0);
  });

  it('refuses a price, a status, an order number or any field it does not know, as a malformed request', async () => {
    const t = setup();
    for (const extra of [
      { price: '1' },
      { status: 'approved' },
      { orderId: '9' },
      { total: '5' },
      { ref: 'KCQ-2701-AAAAAA' },
    ]) {
      const reply = await handleQuoteSubmission(t.post(extra), t.deps());
      expect(reply.status, JSON.stringify(extra)).toBe(400);
      expect(reply.body).toMatchObject({ ok: false, code: 'form_expired' });
    }
    expect(t.calls).toHaveLength(0);
  });

  it('refuses a field sent twice', async () => {
    const t = setup();
    const form = new FormData();
    for (const [k, v] of Object.entries({
      ...good,
      formToken: issueQuoteFormToken(SECRET, T0),
      website: '',
    }))
      form.append(k, v);
    form.append('quantity', '1');
    const req = new Request(`https://${HOST}/api/quotes/`, {
      method: 'POST',
      headers: { host: HOST, origin: `https://${HOST}` },
      body: form,
    });
    expect((await handleQuoteSubmission(req, t.deps())).status).toBe(400);
  });

  it('tells a robot that filled the hidden field that it worked, and sends nothing', async () => {
    const t = setup();
    const reply = await handleQuoteSubmission(t.post({ website: 'http://spam.example' }), t.deps());
    expect(reply.status).toBe(200);
    expect(reply.body).toMatchObject({ ok: true });
    expect(t.calls).toHaveLength(0);
  });

  it('gives the visitor every problem with the form, in words', async () => {
    const t = setup();
    const reply = await handleQuoteSubmission(
      t.post({ name: '', email: 'x', quantity: '0', description: 'short' }),
      t.deps(),
    );
    expect(reply.status).toBe(400);
    expect(reply.body).toMatchObject({ ok: false, code: 'invalid' });
    if (!reply.body.ok && reply.body.code === 'invalid') {
      expect(reply.body.errors.map((e) => e.field)).toEqual([
        'name',
        'email',
        'description',
        'quantity',
      ]);
    }
    // A quantity that is not a whole number is a quantity problem, not a malformed request.
    const text = await handleQuoteSubmission(t.post({ quantity: 'many' }), t.deps());
    expect(text.body).toMatchObject({
      ok: false,
      code: 'invalid',
      errors: [{ field: 'quantity' }],
    });
    expect(t.calls).toHaveLength(0);
  });

  it('refuses a deadline in the past or too far ahead, by the shop’s date', async () => {
    const t = setup();
    for (const [deadline, field] of [
      ['2027-01-14', 'deadline'],
      ['2030-01-01', 'deadline'],
    ] as const) {
      const reply = await handleQuoteSubmission(t.post({ deadline }), t.deps());
      expect(reply.body).toMatchObject({ ok: false, code: 'invalid', errors: [{ field }] });
    }
    expect((await handleQuoteSubmission(t.post({ deadline: '2027-01-15' }), t.deps())).status).toBe(
      200,
    ); // today is fine
  });

  it('refuses pictures that are not pictures, too many, or too big', async () => {
    const t = setup();
    const svg = await handleQuoteSubmission(
      t.post({}, [{ name: 'x.svg', bytes: text('<svg onload=alert(1)>') }]),
      t.deps(),
    );
    expect(svg.body).toMatchObject({ ok: false, code: 'invalid', errors: [{ field: 'files' }] });
    const named = await handleQuoteSubmission(
      t.post({}, [{ name: 'looks-fine.jpg', bytes: text('<?php system("id"); ?>') }]),
      t.deps(),
    );
    expect(named.body).toMatchObject({ ok: false, code: 'invalid', errors: [{ field: 'files' }] });
    const five = await handleQuoteSubmission(
      t.post(
        {},
        Array.from({ length: 5 }, (_, i) => ({ name: `${i}.jpg`, bytes: JPEG })),
      ),
      t.deps(),
    );
    expect(five.body).toMatchObject({ ok: false, code: 'invalid', errors: [{ field: 'files' }] });
    const big = new Uint8Array(UPLOAD_LIMITS.maxFileBytes + 1);
    big.set(JPEG);
    const tooBig = await handleQuoteSubmission(
      t.post({}, [{ name: 'big.jpg', bytes: big }]),
      t.deps(),
    );
    expect(tooBig.body).toMatchObject({ ok: false, code: 'invalid', errors: [{ field: 'files' }] });
    expect(t.calls).toHaveLength(0);
  });

  it('wants a form token this server signed, not too fast and not too old', async () => {
    const t = setup();
    const forged = await handleQuoteSubmission(
      t.post({}, [], {}, `${T0 / 1000}.${'a'.repeat(64)}`),
      t.deps(),
    );
    expect(forged.body).toMatchObject({ ok: false, code: 'form_expired' });
    const missing = await handleQuoteSubmission(t.post({ formToken: undefined }), t.deps());
    expect(missing.body).toMatchObject({ ok: false, code: 'form_expired' });
    const quick = { ...t.deps(), now: () => T0 + 1000 };
    expect((await handleQuoteSubmission(t.post(), quick)).body).toMatchObject({
      ok: false,
      code: 'try_again',
    });
    const old = { ...t.deps(), now: () => T0 + (MAX_AGE_SECONDS + 5) * 1000 };
    expect((await handleQuoteSubmission(t.post(), old)).body).toMatchObject({
      ok: false,
      code: 'form_expired',
    });
    expect(t.calls).toHaveLength(0);
  });

  it('limits each visitor, and the shop as a whole, and says when to come back', async () => {
    const t = setup();
    const statuses: number[] = [];
    for (let i = 0; i < 6; i += 1)
      statuses.push((await handleQuoteSubmission(t.post(), t.deps())).status);
    expect(statuses).toEqual([200, 200, 200, 200, 429, 429]);
    const limited = await handleQuoteSubmission(t.post(), t.deps());
    expect(limited.headers?.['Retry-After']).toMatch(/^\d+$/);
    expect(t.calls).toHaveLength(4);
    // Another visitor still gets through.
    expect(
      (await handleQuoteSubmission(t.post({}, [], { 'x-real-ip': '203.0.113.99' }), t.deps()))
        .status,
    ).toBe(200);
  });
});

describe('POST /api/quotes/: what is sent to the shop', () => {
  it('passes the checked request, the real pictures and a hash of the visitor, signed, and gives back only the reference', async () => {
    const t = setup();
    const reply = await handleQuoteSubmission(
      t.post({ name: '  Robin   Hood ', email: 'ROBIN@Example.com' }, [
        { name: 'my case.PNG', bytes: JPEG },
      ]),
      t.deps(),
    );
    expect(reply).toEqual({ status: 200, body: { ok: true, ref: 'KCQ-2701-ABCD23' } });
    expect(t.calls).toHaveLength(1);
    const call = t.calls[0]!;
    expect(call.url).toBe('https://shop.example.test/wp-json/kcpw-quotes/v1/requests');
    expect(call.init.redirect).toBe('error');
    const body = JSON.parse(String(call.init.body));
    expect(Object.keys(body).sort()).toEqual(['clientKey', 'files', 'request']);
    expect(body.request).toMatchObject({
      name: 'Robin Hood',
      email: 'robin@example.com',
      quantity: 2,
      deadline: '2027-03-01',
    });
    expect(Object.keys(body.request).sort()).toEqual(
      [
        'colors',
        'deadline',
        'description',
        'dimensions',
        'email',
        'game',
        'name',
        'projectType',
        'quantity',
        'shipTo',
      ].sort(),
    );
    expect(body.files).toEqual([
      { name: 'my case.jpg', type: 'image/jpeg', data: Buffer.from(JPEG).toString('base64') },
    ]);
    // The visitor's address is only ever a keyed hash.
    expect(body.clientKey).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(body)).not.toContain('203.0.113.7');
    // Signed exactly as kcpw-core's requests are, over this body.
    const headers = call.init.headers as Record<string, string>;
    const canonical = [
      'KCPW1',
      headers['x-kcpw-timestamp'],
      headers['x-kcpw-nonce'],
      'POST',
      '/kcpw-quotes/v1/requests',
      createHash('sha256').update(String(call.init.body)).digest('hex'),
    ].join('\n');
    expect(headers['x-kcpw-signature']).toBe(
      createHmac('sha256', SECRET).update(canonical).digest('hex'),
    );
    expect(JSON.stringify(reply)).not.toContain(SECRET);
  });

  it('turns every kind of trouble at the shop into one plain sentence for the visitor, and tells the operator why', async () => {
    const cases: [number, unknown, string, RegExp][] = [
      [401, { code: 'kcpw_unauthorized' }, 'unavailable', /signature/],
      [503, { code: 'kcpw_not_configured' }, 'unavailable', /not set up/],
      [404, { code: 'rest_no_route' }, 'unavailable', /kcpw-quotes/],
      [500, { ok: false, status: 'server_error' }, 'unavailable', /HTTP 500/],
      [400, { ok: false, status: 'invalid_request' }, 'unavailable', /refused/],
      [200, { ok: true, status: 'received', ref: 'not a reference' }, 'unavailable', /HTTP 200/],
      [429, { ok: false, status: 'rate_limited' }, 'rate_limited', /^$/],
      [400, { ok: false, status: 'invalid_file' }, 'bad_file', /^$/],
    ];
    for (const [status, json, code, why] of cases) {
      const t = setup(() => Response.json(json, { status }));
      const reply = await handleQuoteSubmission(t.post(), t.deps());
      expect(reply.body, `${status}`).toMatchObject({ ok: false, code });
      expect(t.logs.join(' ')).toMatch(why);
      expect(JSON.stringify(reply)).not.toContain('kcpw_');
    }
    const down = setup(() => Promise.reject(new TypeError('fetch failed')));
    const reply = await handleQuoteSubmission(down.post(), down.deps());
    expect(reply.body).toMatchObject({ ok: false, code: 'unavailable' });
    expect(reply.status).toBe(503);
    const html = setup(() => new Response('<html>down</html>', { status: 502 }));
    expect((await handleQuoteSubmission(html.post(), html.deps())).status).toBe(503);
  });
});
