import type { FreeShippingRule } from './free-shipping';

/**
 * The cart's free-shipping rule, read from the container's environment on every request (no rebuild to change it):
 *
 *   FREE_SHIPPING_THRESHOLD         dollars, e.g. 40 or 40.00. Empty or unset means the default below. "off" (or 0) hides the bar.
 *                                   It must match the minimum order amount of the Free Shipping method in WooCommerce: this
 *                                   storefront only DISPLAYS progress toward it, WooCommerce decides and charges.
 *   FREE_SHIPPING_BEFORE_DISCOUNTS  "true" when that WooCommerce method has "Apply minimum order rule before coupon discount"
 *                                   ticked. Default false, which is WooCommerce's default (discounts count against the minimum).
 *
 * A value that is not a dollar amount shows no bar at all rather than a guess, and the server log says why.
 */
export const DEFAULT_FREE_SHIPPING_MINOR = 4000;

const OFF = new Set(['off', 'none', 'disabled', 'false', '0', '0.00']);
const DOLLARS = /^\$?(\d{1,6})(?:\.(\d{1,2}))?$/;

const warned = new Set<string>();
const warnOnce = (message: string) => {
  if (warned.has(message)) return;
  warned.add(message);
  console.warn(`[free-shipping] ${message}`);
};

export function readFreeShippingRule(
  env: Record<string, string | undefined> = process.env,
  warn: (message: string) => void = warnOnce,
): FreeShippingRule | null {
  const ignoreDiscounts = env.FREE_SHIPPING_BEFORE_DISCOUNTS === 'true';
  const text = (env.FREE_SHIPPING_THRESHOLD ?? '').trim();
  if (text === '') return { thresholdMinor: DEFAULT_FREE_SHIPPING_MINOR, ignoreDiscounts };
  if (OFF.has(text.toLowerCase())) return null;

  const match = DOLLARS.exec(text);
  if (!match) {
    warn(
      `FREE_SHIPPING_THRESHOLD "${text}" is not a dollar amount such as 40 or 40.00, so no free-shipping bar is shown.`,
    );
    return null;
  }
  // Exact arithmetic on the digits: no floating point near money.
  const cents = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return cents > 0 ? { thresholdMinor: cents, ignoreDiscounts } : null;
}
