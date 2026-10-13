import { describe, expect, it } from 'vitest';
import { lineKey, type CartLineIntent } from '@kcpw/contracts';
import {
  addLine,
  cartCount,
  parseStoredCart,
  removeLine,
  setQuantity,
} from '@/lib/cart/cart-state';

const a: CartLineIntent = { productId: 101, quantity: 1, options: { name: 'Ada', frame: 'black' } };

describe('cart state', () => {
  it('merges identical lines and adds quantities', () => {
    const lines = addLine(addLine([], a), { ...a, quantity: 2 });
    expect(lines).toHaveLength(1);
    expect(lines[0]?.quantity).toBe(3);
  });

  it('keeps different personalization on separate lines', () => {
    const lines = addLine(addLine([], a), { ...a, options: { name: 'Bea', frame: 'black' } });
    expect(lines).toHaveLength(2);
    expect(cartCount(lines)).toBe(2);
  });

  it('caps quantity at 99 and the number of lines at 50', () => {
    expect(addLine([{ ...a, quantity: 98 }], { ...a, quantity: 5 })[0]?.quantity).toBe(99);
    let lines: CartLineIntent[] = [];
    for (let i = 1; i <= 60; i += 1)
      lines = addLine(lines, { productId: i, quantity: 1, options: {} });
    expect(lines).toHaveLength(50);
  });

  it('sets quantity, removes at zero, and removes by key', () => {
    const lines = addLine([], a);
    const key = lineKey(a);
    expect(setQuantity(lines, key, 5)[0]?.quantity).toBe(5);
    expect(setQuantity(lines, key, 0)).toEqual([]);
    expect(setQuantity(lines, key, Number.NaN)).toEqual([]);
    expect(removeLine(lines, key)).toEqual([]);
  });

  it('does not mutate its input', () => {
    const lines = Object.freeze([Object.freeze({ ...a })]);
    expect(() => addLine(lines, a)).not.toThrow();
    expect(lines[0]?.quantity).toBe(1);
  });
});

describe('parseStoredCart', () => {
  it('returns [] for missing, corrupt, or non-array storage', () => {
    expect(parseStoredCart(null)).toEqual([]);
    expect(parseStoredCart('not json')).toEqual([]);
    expect(parseStoredCart('{"a":1}')).toEqual([]);
  });

  it('drops lines that fail validation, including ones that carry a price', () => {
    const stored = JSON.stringify([
      a,
      { productId: 1, quantity: 1, options: {}, price: 1 },
      { productId: -3, quantity: 1, options: {} },
      { productId: 2, quantity: 500, options: {} },
    ]);
    expect(parseStoredCart(stored)).toEqual([a]);
  });
});
