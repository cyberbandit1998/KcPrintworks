import { describe, expect, it } from 'vitest';
import { addMoney, formatMoney, money, multiplyMoney, percentOf } from '../src';

describe('money', () => {
  it('rejects non-integer amounts', () => {
    expect(() => money(10.5)).toThrow();
  });

  it('adds and multiplies in minor units', () => {
    expect(addMoney(money(1999), money(1)).amount).toBe(2000);
    expect(multiplyMoney(money(1250), 3).amount).toBe(3750);
  });

  it('refuses to mix currencies', () => {
    expect(() => addMoney(money(100, 'USD'), money(100, 'EUR'))).toThrow(/Currency mismatch/);
  });

  it.each([
    [2400, 1500, 360], // 15% of $24.00 = $3.60
    [999, 1000, 100], // 10% of $9.99 = 99.9 cents -> rounds to 100
    [995, 1000, 100], // 99.5 -> half rounds up
    [994, 1000, 99], // 99.4 -> rounds down
    [1, 5000, 1], // 0.5 cent -> rounds up
    [0, 2500, 0],
    [-995, 1000, -100], // half away from zero
  ])('percentOf(%i, %i bp) = %i', (amount, bp, expected) => {
    expect(percentOf(money(amount), bp).amount).toBe(expected);
  });

  it('formats USD from minor units', () => {
    expect(formatMoney(money(2400))).toBe('$24.00');
    expect(formatMoney(money(5))).toBe('$0.05');
  });
});
