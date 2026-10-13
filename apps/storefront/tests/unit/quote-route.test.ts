import { describe, expect, it } from 'vitest';
import { QuoteResponseSchema } from '@kcpw/contracts';
import { POST } from '@/app/api/cart/quote/route';

function call(body: unknown, raw = false) {
  return POST(
    new Request('http://localhost/api/cart/quote/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: raw ? (body as string) : JSON.stringify(body),
    }),
  );
}

describe('POST /api/cart/quote', () => {
  it('prices valid lines and totals them', async () => {
    const res = await call({
      lines: [
        { productId: 101, quantity: 2, options: { name: 'Ada', frame: 'natural', gift: true } },
        { productId: 103, quantity: 1, options: {} },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const quote = QuoteResponseSchema.parse(await res.json());
    // print: 2400 + 600 + 400 = 3400 each x2 = 6800; stickers 800
    expect(quote.subtotal.amount).toBe(7600);
    expect(quote.checkoutReady).toBe(true);
  });

  it('rejects a client-supplied price with 400 and does not price it', async () => {
    const res = await call({
      lines: [{ productId: 101, quantity: 1, options: { name: 'A', frame: 'black' }, price: 1 }],
    });
    expect(res.status).toBe(400);
  });

  it('rejects malformed JSON and oversized bodies', async () => {
    expect((await call('{nope', true)).status).toBe(400);
    const big = POST(
      new Request('http://localhost/api/cart/quote/', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': '999999' },
        body: '{}',
      }),
    );
    expect((await big).status).toBe(413);
  });

  it('reports invalid personalization, unknown products, and sold-out items without charging for them', async () => {
    const res = await call({
      lines: [
        { productId: 101, quantity: 1, options: { frame: 'black' } }, // missing required name
        { productId: 999, quantity: 1, options: {} },
        { productId: 105, quantity: 1, options: {} }, // sold out
      ],
    });
    const quote = QuoteResponseSchema.parse(await res.json());
    expect(quote.lines.map((l) => l.issues.map((i) => i.code))).toEqual([
      ['invalid_option'],
      ['unknown_product'],
      ['out_of_stock'],
    ]);
    expect(quote.subtotal.amount).toBe(0);
    expect(quote.checkoutReady).toBe(false);
  });

  it('does not accept coupons in the preview', async () => {
    const res = await call({
      lines: [{ productId: 103, quantity: 1, options: {} }],
      coupon: 'SAVE10',
    });
    const quote = QuoteResponseSchema.parse(await res.json());
    expect(quote.issues[0]?.code).toBe('coupon_invalid');
    expect(quote.checkoutReady).toBe(false);
  });
});
