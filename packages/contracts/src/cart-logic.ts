import type { CartLineIntent } from './cart';

/**
 * Cart rules that need no validation library, so the browser can use them without downloading it.
 * The schemas that enforce the same limits for untrusted input are in cart.ts; a parity test keeps the
 * two in agreement.
 */

export const MAX_LINE_QUANTITY = 99;
export const MAX_CART_LINES = 50;

export const ISSUE_CODES = [
  'unknown_product',
  'unavailable',
  'invalid_variation',
  'out_of_stock',
  'quantity_limit',
  'invalid_option',
  'coupon_invalid',
] as const;
export type IssueCode = (typeof ISSUE_CODES)[number];

/** Deterministic key so identical product + variation + choices merge, and different choices never do. */
export function lineKey(
  line: Pick<CartLineIntent, 'productId' | 'variationId' | 'options'> &
    Partial<Pick<CartLineIntent, 'attributes'>>,
): string {
  const sortedEntries = (record: Record<string, string | boolean>) =>
    Object.entries(record)
      .filter(([, v]) => v !== '' && v !== false)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return JSON.stringify([
    line.productId,
    line.variationId ?? 0,
    sortedEntries(line.attributes ?? {}),
    sortedEntries(line.options ?? {}),
  ]);
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Own keys of a parsed-JSON record, minus `__proto__` (zod drops it too, so the two readers agree). */
const safeEntries = (record: Record<string, unknown>) =>
  Object.entries(record).filter(([key]) => key !== '__proto__');

const isPositiveInt = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0;

const CART_LINE_KEYS = new Set(['productId', 'variationId', 'attributes', 'quantity', 'options']);

/**
 * Read one stored cart line, or `undefined` if it is not a valid line intent. Same rules as
 * `CartLineIntentSchema` (strict: an unknown field such as `price` invalidates the line), for code that
 * reads the browser's own storage and must not pull in the validation library. The server always
 * re-validates with the schema.
 */
export function readCartLineIntent(input: unknown): CartLineIntent | undefined {
  if (!isPlainObject(input)) return undefined;
  if (Object.keys(input).some((key) => !CART_LINE_KEYS.has(key))) return undefined;

  const { productId, variationId, attributes, quantity, options } = input;
  if (!isPositiveInt(productId)) return undefined;
  if (variationId !== undefined && !isPositiveInt(variationId)) return undefined;
  if (!isPositiveInt(quantity) || quantity > MAX_LINE_QUANTITY) return undefined;

  let readAttributes: Record<string, string> | undefined;
  if (attributes !== undefined) {
    if (!isPlainObject(attributes)) return undefined;
    const entries = safeEntries(attributes);
    if (entries.some(([, v]) => typeof v !== 'string' || Array.from(v).length > 100))
      return undefined;
    readAttributes = Object.fromEntries(entries) as Record<string, string>;
  }

  let readOptions: Record<string, string | boolean> = {};
  if (options !== undefined) {
    if (!isPlainObject(options)) return undefined;
    const entries = safeEntries(options);
    const valid = entries.every(
      ([, v]) => typeof v === 'boolean' || (typeof v === 'string' && Array.from(v).length <= 1000),
    );
    if (!valid) return undefined;
    readOptions = Object.fromEntries(entries) as Record<string, string | boolean>;
  }

  return {
    productId,
    ...(variationId !== undefined ? { variationId } : {}),
    ...(readAttributes !== undefined ? { attributes: readAttributes } : {}),
    quantity,
    options: readOptions,
  };
}
