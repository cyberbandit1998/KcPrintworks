/**
 * Money is always an integer count of the currency's minor unit (cents for USD).
 * No floating point is used for arithmetic anywhere in the project.
 */
export interface Money {
  /** Integer minor units. */
  amount: number;
  /** ISO 4217 code, three letters. */
  currency: string;
}

export const DEFAULT_CURRENCY = 'USD';

export function money(amount: number, currency: string = DEFAULT_CURRENCY): Money {
  if (!Number.isInteger(amount)) throw new Error(`Money amount must be an integer, got ${amount}`);
  return { amount, currency };
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new Error(`Currency mismatch: ${a.currency} vs ${b.currency}`);
  }
}

export function addMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { amount: a.amount + b.amount, currency: a.currency };
}

export function multiplyMoney(a: Money, quantity: number): Money {
  if (!Number.isInteger(quantity)) throw new Error('Quantity must be an integer');
  return { amount: a.amount * quantity, currency: a.currency };
}

/**
 * `basisPoints` of an amount (100 bp = 1%), rounded half away from zero to the minor unit.
 * Uses integer arithmetic only.
 */
export function percentOf(a: Money, basisPoints: number): Money {
  if (!Number.isInteger(basisPoints)) throw new Error('Basis points must be an integer');
  const numerator = a.amount * basisPoints;
  const sign = numerator < 0 ? -1 : 1;
  const rounded = sign * Math.floor((Math.abs(numerator) * 2 + 10_000) / 20_000);
  return { amount: rounded, currency: a.currency };
}

export const zero = (currency: string = DEFAULT_CURRENCY): Money => ({ amount: 0, currency });

export function formatMoney(value: Money, locale = 'en-US'): string {
  const fractionDigits = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: value.currency,
  }).resolvedOptions().maximumFractionDigits;
  const divisor = 10 ** (fractionDigits ?? 2);
  return new Intl.NumberFormat(locale, { style: 'currency', currency: value.currency }).format(
    value.amount / divisor,
  );
}
