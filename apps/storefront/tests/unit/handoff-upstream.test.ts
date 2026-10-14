import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { acceptableRedirect, requestHandoff, requestShopStatus } from '@/lib/handoff/upstream';
import { canonicalString, signRequest, signedHeaders } from '@/lib/handoff/sign';
import { createMockWoo, MOCK_HANDOFF_SECRET } from '../support/mock-woo.mjs';

const vectors = JSON.parse(
  readFileSync(
    resolve(__dirname, '../../../../packages/contracts/test/vectors/signing.json'),
    'utf8',
  ),
) as {
  secret: string;
  cases: {
    name: string;
    timestamp: string;
    nonce: string;
    method: string;
    route: string;
    body: string;
    signature: string;
  }[];
};

import { WOO_TEST } from '../support/woo-test';

describe('request signing (shared vectors with kcpw-core)', () => {
  it('uses one secret for the mock shop and the end-to-end server', () => {
    expect(WOO_TEST.handoffSecret).toBe(MOCK_HANDOFF_SECRET);
  });

  it('produces the same signatures as the PHP side', () => {
    expect(vectors.cases.length).toBeGreaterThanOrEqual(3);
    for (const c of vectors.cases) {
      expect(signRequest(vectors.secret, c), c.name).toBe(c.signature);
    }
  });

  it('builds fresh headers every time and never contains the secret', () => {
    const a = signedHeaders(
      MOCK_HANDOFF_SECRET,
      'POST',
      '/kcpw/v1/cart/handoff',
      '{}',
      new Date(1_800_000_000_000),
    );
    const b = signedHeaders(
      MOCK_HANDOFF_SECRET,
      'POST',
      '/kcpw/v1/cart/handoff',
      '{}',
      new Date(1_800_000_000_000),
    );
    expect(a['x-kcpw-timestamp']).toBe('1800000000');
    expect(a['x-kcpw-nonce']).not.toBe(b['x-kcpw-nonce']);
    expect(a['x-kcpw-signature']).not.toBe(b['x-kcpw-signature']);
    expect(JSON.stringify(a)).not.toContain(MOCK_HANDOFF_SECRET);
    expect(a['x-kcpw-nonce']).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect(
      canonicalString({ timestamp: '1', nonce: 'n', method: 'post', route: '/r', body: '' }).split(
        '\n',
      )[3],
    ).toBe('POST');
  });
});

describe('the checkout link the shop returns', () => {
  const api = 'https://shop.example.com';
  const token = 'a'.repeat(43);

  it('is accepted only if it is the shop host’s own single-use link', () => {
    expect(acceptableRedirect(`${api}/?kcpw_handoff=${token}`, api)).toBe(
      `${api}/?kcpw_handoff=${token}`,
    );
    for (const bad of [
      `https://evil.example.net/?kcpw_handoff=${token}`,
      `http://shop.example.com/?kcpw_handoff=${token}`,
      `https://shop.example.com.evil.net/?kcpw_handoff=${token}`,
      `https://user:pass@shop.example.com/?kcpw_handoff=${token}`,
      `${api}/checkout/?kcpw_handoff=${token}`,
      `${api}/?kcpw_handoff=short`,
      `${api}/?kcpw_handoff=${token}&x=1`,
      `${api}/?other=${token}`,
      `${api}/?kcpw_handoff=${token}#frag`,
      `//shop.example.com/?kcpw_handoff=${token}`,
      'javascript:alert(1)',
      'not a url',
      '',
    ]) {
      expect(acceptableRedirect(bad, api), bad).toBeUndefined();
    }
  });
});

describe('talking to the shop', () => {
  const mock = createMockWoo();
  let config: { apiUrl: string; secret: string };
  const line = (extra: Record<string, unknown> = {}) => ({
    productId: 103,
    variationId: 7001,
    quantity: 1,
    ...extra,
  });

  beforeAll(async () => {
    config = { apiUrl: await mock.start(), secret: MOCK_HANDOFF_SECRET };
  });
  afterAll(() => mock.stop());

  it('gets a single-use checkout link for a valid cart, signed correctly', async () => {
    const before = mock.log.core.length;
    const result = await requestHandoff(config, [line({ quantity: 2 })], 2500);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.redirectUrl.startsWith(`${config.apiUrl}/?kcpw_handoff=`)).toBe(true);
    const sent = mock.log.core.at(before)!;
    expect(sent.method).toBe('POST');
    expect(JSON.parse(sent.body)).toEqual({
      lines: [line({ quantity: 2 })],
      expectedSubtotal: 2500,
    });
    expect(sent.body).not.toMatch(/price/i);
    expect(sent.body).not.toContain(MOCK_HANDOFF_SECRET);
  });

  it('reports line problems, a changed subtotal, and a bad secret distinctly', async () => {
    const out = await requestHandoff(config, [line({ variationId: 7002 })], 1250);
    expect(out).toMatchObject({
      kind: 'invalid_lines',
      lines: [{ index: 0, issues: [{ code: 'out_of_stock' }] }],
    });
    expect(await requestHandoff(config, [line()], 1)).toMatchObject({
      kind: 'changed',
      subtotal: 1250,
    });
    const wrong = await requestHandoff({ ...config, secret: 'y'.repeat(40) }, [line()], 1250);
    expect(wrong.kind).toBe('unavailable');
    expect(JSON.stringify(wrong)).not.toContain('y'.repeat(40));
  });

  it('turns every kind of upstream failure into "unavailable" and never throws', async () => {
    const cases: [string, typeof fetch][] = [
      [
        'network down',
        (async () => {
          throw new TypeError('fetch failed');
        }) as unknown as typeof fetch,
      ],
      [
        'not JSON',
        (async () => new Response('<html>oops</html>', { status: 200 })) as unknown as typeof fetch,
      ],
      [
        'server error',
        (async () => Response.json({ x: 1 }, { status: 500 })) as unknown as typeof fetch,
      ],
      [
        'success without a link',
        (async () =>
          Response.json({
            ok: true,
            subtotal: 1,
            redirectUrl: 'https://evil.example.net/?kcpw_handoff=' + 'a'.repeat(43),
          })) as unknown as typeof fetch,
      ],
      ['garbage success', (async () => Response.json({ ok: true })) as unknown as typeof fetch],
    ];
    for (const [name, fetchImpl] of cases) {
      const result = await requestHandoff(config, [line()], 1250, fetchImpl);
      expect(result.kind, name).toBe('unavailable');
    }
  });

  it('does not follow a redirect with the signed request attached', async () => {
    let seen: RequestInit | undefined;
    const fetchImpl = (async (_url: URL, init?: RequestInit) => {
      seen = init;
      throw new TypeError('redirect mode is set to error');
    }) as unknown as typeof fetch;
    await requestHandoff(config, [line()], 1250, fetchImpl);
    expect(seen?.redirect).toBe('error');
    expect(seen?.cache).toBe('no-store');
  });

  it('shop status says whether the link is set up, and why not', async () => {
    const ok = await requestShopStatus(config);
    expect(ok).toMatchObject({
      reachable: true,
      status: { plugin: '0.1.0-mock', stripeTestMode: true },
    });
    const bad = await requestShopStatus({ ...config, secret: 'z'.repeat(40) });
    expect(bad).toMatchObject({ reachable: false });
    expect(JSON.stringify(bad)).toContain('KCPW_HANDOFF_SECRET');
  });
});
