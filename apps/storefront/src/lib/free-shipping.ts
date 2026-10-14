import { formatMoney, type Money } from '@kcpw/contracts/client';

/**
 * The free-shipping progress shown in the cart. It is a DISPLAY of how far the items are from the shop's free-shipping minimum
 * and never a decision: WooCommerce applies its own shipping rules at checkout and stays the only source of the shipping charge.
 * This module never sees a shipping cost (there is no input for one), so a flat rate or any other charge cannot leak into the
 * progress. Pure and free of the validation library, so the browser may import it (see the budget rule in CLAUDE.md).
 */
export interface FreeShippingRule {
  /** The items subtotal at which the shop's Free Shipping method applies, in minor units (4000 = $40.00). */
  thresholdMinor: number;
  /**
   * WooCommerce's "Apply minimum order rule before coupon discount". When true, discounts do not count against the minimum;
   * when false (WooCommerce's default) the minimum is compared with the items total AFTER discounts.
   */
  ignoreDiscounts: boolean;
}

export interface FreeShippingInput {
  rule: FreeShippingRule | null;
  /** The items total, before discounts, excluding shipping and tax. */
  subtotal: Money;
  /** Discounts already applied to the items, if the cart knows of any. */
  discount?: Money;
  /** False whenever the figures cannot be trusted: prices not loaded or failed, or an item with a problem. */
  reliable: boolean;
}

export interface FreeShippingStatus {
  unlocked: boolean;
  /** Whole percent 0..100. 100 only when unlocked: $39.99 of $40.00 is 99, never a full bar. */
  percent: number;
  /** What is still missing; zero once unlocked. */
  remaining: Money;
  message: string;
}

export const FREE_SHIPPING_UNLOCKED = "You've unlocked FREE shipping!";
export const freeShippingAway = (remaining: Money) =>
  `You're only ${formatMoney(remaining)} away from free shipping!`;

const isCents = (value: number) => Number.isSafeInteger(value) && value >= 0;

/**
 * Where the cart stands against the free-shipping minimum, or null when that cannot be said accurately (no rule, an unreliable
 * cart, a nonsensical amount). Null means: show nothing and promise nothing.
 */
export function freeShippingProgress(input: FreeShippingInput): FreeShippingStatus | null {
  const { rule, subtotal, discount, reliable } = input;
  if (!rule || !reliable) return null;
  if (!Number.isSafeInteger(rule.thresholdMinor) || rule.thresholdMinor <= 0) return null;
  if (!isCents(subtotal.amount)) return null;
  if (discount && (!isCents(discount.amount) || discount.currency !== subtotal.currency)) {
    return null;
  }

  const counted = rule.ignoreDiscounts
    ? subtotal.amount
    : Math.max(0, subtotal.amount - (discount?.amount ?? 0));
  const currency = subtotal.currency;

  if (counted >= rule.thresholdMinor) {
    return {
      unlocked: true,
      percent: 100,
      remaining: { amount: 0, currency },
      message: FREE_SHIPPING_UNLOCKED,
    };
  }
  const remaining = { amount: rule.thresholdMinor - counted, currency };
  return {
    unlocked: false,
    percent: Math.min(99, Math.floor((counted * 100) / rule.thresholdMinor)),
    remaining,
    message: freeShippingAway(remaining),
  };
}

/**
 * The items total for the cart as it is NOW, worked out from the unit prices of the last quote, so a quantity change moves the
 * bar at once instead of after the next round trip. Null when any current line has no price on file or has a problem, or the
 * prices are in different currencies: then nothing can be said until a fresh quote arrives.
 */
export function estimateItemsSubtotal(
  lines: { key: string; quantity: number }[],
  priced: { key: string; unitPrice: Money; issues: unknown[] }[],
): Money | null {
  let total = 0;
  let currency: string | undefined;
  for (const line of lines) {
    const match = priced.find((p) => p.key === line.key);
    if (!match || match.issues.length > 0) return null;
    if (!Number.isSafeInteger(line.quantity) || line.quantity < 1) return null;
    if (currency !== undefined && currency !== match.unitPrice.currency) return null;
    currency = match.unitPrice.currency;
    total += match.unitPrice.amount * line.quantity;
  }
  return currency === undefined || !Number.isSafeInteger(total)
    ? null
    : { amount: total, currency };
}
