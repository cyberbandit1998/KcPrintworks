import { describe, expect, it } from 'vitest';
import { HandoffRequestSchema, HandoffResponseSchema } from '../src';

describe('handoff contract', () => {
  const line = { productId: 11, quantity: 1, options: { name: 'Robin' } };

  it('accepts line intents only', () => {
    expect(HandoffRequestSchema.safeParse({ lines: [line] }).success).toBe(true);
  });

  it('rejects any price, total, or extra field, anywhere', () => {
    expect(HandoffRequestSchema.safeParse({ lines: [{ ...line, price: 1 }] }).success).toBe(false);
    expect(HandoffRequestSchema.safeParse({ lines: [line], total: 1 }).success).toBe(false);
    expect(HandoffRequestSchema.safeParse({ lines: [line], expectedSubtotal: 1 }).success).toBe(
      false,
    );
    expect(HandoffRequestSchema.safeParse({ lines: [] }).success).toBe(false);
    expect(HandoffRequestSchema.safeParse({ lines: Array(51).fill(line) }).success).toBe(false);
  });

  it('describes success and each failure', () => {
    expect(
      HandoffResponseSchema.safeParse({
        ok: true,
        redirectUrl: 'https://shop.example.com/?kcpw_handoff=abc',
      }).success,
    ).toBe(true);
    expect(HandoffResponseSchema.safeParse({ ok: false, error: 'changed' }).success).toBe(true);
    expect(
      HandoffResponseSchema.safeParse({
        ok: false,
        error: 'invalid_lines',
        lines: [{ index: 0, issues: [{ code: 'out_of_stock', message: 'x' }] }],
      }).success,
    ).toBe(true);
    expect(HandoffResponseSchema.safeParse({ ok: false, error: 'whatever' }).success).toBe(false);
  });
});
