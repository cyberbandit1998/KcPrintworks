import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_FREE_SHIPPING_MINOR, readFreeShippingRule } from '@/lib/free-shipping-config';

const rule = (env: Record<string, string | undefined>) =>
  readFreeShippingRule(env, () => undefined);

describe('FREE_SHIPPING_THRESHOLD (read on every request, so a changed .env needs no rebuild)', () => {
  it('defaults to $40.00 when unset or empty (compose passes unset names as empty)', () => {
    expect(DEFAULT_FREE_SHIPPING_MINOR).toBe(4000);
    expect(rule({})).toEqual({ thresholdMinor: 4000, ignoreDiscounts: false });
    expect(rule({ FREE_SHIPPING_THRESHOLD: '' })).toMatchObject({ thresholdMinor: 4000 });
    expect(rule({ FREE_SHIPPING_THRESHOLD: '   ' })).toMatchObject({ thresholdMinor: 4000 });
  });

  it('reads dollars with up to two decimals, exactly (no floating point)', () => {
    const cents: [string, number][] = [
      ['40', 4000],
      ['40.00', 4000],
      ['$40', 4000],
      ['35.5', 3550],
      ['25.05', 2505],
      ['0.10', 10],
      [' 75.99 ', 7599],
      ['1234.56', 123456],
    ];
    for (const [text, expected] of cents) {
      expect(rule({ FREE_SHIPPING_THRESHOLD: text }), text).toMatchObject({
        thresholdMinor: expected,
      });
    }
  });

  it('can be switched off, in which case no bar is shown', () => {
    for (const text of ['off', 'OFF', 'none', 'disabled', 'false', '0', '0.00']) {
      expect(rule({ FREE_SHIPPING_THRESHOLD: text }), text).toBeNull();
    }
  });

  it('shows nothing, rather than guessing, when the value makes no sense (and says so in the log)', () => {
    const logged: string[] = [];
    for (const text of ['abc', '-5', '40.123', '1e3', '4 0', '40,00', '999999999']) {
      expect(
        readFreeShippingRule({ FREE_SHIPPING_THRESHOLD: text }, (m) => logged.push(m)),
        text,
      ).toBeNull();
    }
    expect(logged).toHaveLength(7);
    expect(logged[0]).toContain('FREE_SHIPPING_THRESHOLD');
  });
});

describe('FREE_SHIPPING_BEFORE_DISCOUNTS mirrors WooCommerce’s "apply minimum before coupon discount"', () => {
  it('is off unless exactly "true"', () => {
    expect(rule({})!.ignoreDiscounts).toBe(false);
    for (const text of ['', 'false', '1', 'yes', 'TRUE']) {
      expect(rule({ FREE_SHIPPING_BEFORE_DISCOUNTS: text })!.ignoreDiscounts, text).toBe(false);
    }
    expect(rule({ FREE_SHIPPING_BEFORE_DISCOUNTS: 'true' })!.ignoreDiscounts).toBe(true);
  });
});

describe('the process environment is read at call time', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('follows changes without a reload of the module', () => {
    vi.stubEnv('FREE_SHIPPING_THRESHOLD', '25');
    expect(readFreeShippingRule()).toMatchObject({ thresholdMinor: 2500 });
    vi.stubEnv('FREE_SHIPPING_THRESHOLD', 'off');
    expect(readFreeShippingRule()).toBeNull();
  });
});
