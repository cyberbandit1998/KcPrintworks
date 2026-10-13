import { z } from 'zod';
import { MoneySchema } from './money';

/**
 * Cart contracts.
 *
 * The browser stores only LINE INTENTS (what the shopper wants), never prices. `.strict()` means a request
 * that includes a `price`, `total`, or any other unexpected field is rejected outright rather than ignored,
 * which is how "prices are never accepted from the client" is enforced and tested.
 */

export const MAX_LINE_QUANTITY = 99;
export const MAX_CART_LINES = 50;

export const CartLineIntentSchema = z
  .object({
    productId: z.number().int().positive(),
    variationId: z.number().int().positive().optional(),
    quantity: z.number().int().min(1).max(MAX_LINE_QUANTITY),
    options: z.record(z.string(), z.union([z.string().max(1000), z.boolean()])).default({}),
  })
  .strict();
export type CartLineIntent = z.infer<typeof CartLineIntentSchema>;

export const QuoteRequestSchema = z
  .object({
    lines: z.array(CartLineIntentSchema).max(MAX_CART_LINES),
    coupon: z.string().max(60).optional(),
  })
  .strict();
export type QuoteRequest = z.infer<typeof QuoteRequestSchema>;

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

export const QuoteIssueSchema = z.object({
  code: z.enum(ISSUE_CODES),
  /** Option field ID when `code` is `invalid_option`. */
  field: z.string().optional(),
  message: z.string(),
});
export type QuoteIssue = z.infer<typeof QuoteIssueSchema>;

export const QuoteLineSchema = z.object({
  /** Stable key for this line; equals `lineKey(intent)`. */
  key: z.string(),
  productId: z.number().int(),
  variationId: z.number().int().optional(),
  slug: z.string().optional(),
  name: z.string(),
  variationLabel: z.string().optional(),
  image: z
    .object({ url: z.string(), alt: z.string(), width: z.number(), height: z.number() })
    .optional(),
  quantity: z.number().int(),
  unitPrice: MoneySchema,
  optionAdders: MoneySchema,
  lineTotal: MoneySchema,
  optionSummary: z.array(z.object({ fieldId: z.string(), label: z.string(), value: z.string() })),
  issues: z.array(QuoteIssueSchema),
});
export type QuoteLine = z.infer<typeof QuoteLineSchema>;

export const QuoteResponseSchema = z.object({
  lines: z.array(QuoteLineSchema),
  subtotal: MoneySchema,
  issues: z.array(QuoteIssueSchema),
  /** True when every line is valid and checkout may be attempted. */
  checkoutReady: z.boolean(),
  /** Shipping, tax, and final discounts are calculated by WooCommerce at checkout. */
  note: z.string(),
});
export type QuoteResponse = z.infer<typeof QuoteResponseSchema>;

/** Deterministic key so identical product + variation + options merge, and different options never do. */
export function lineKey(
  line: Pick<CartLineIntent, 'productId' | 'variationId' | 'options'>,
): string {
  const entries = Object.entries(line.options ?? {})
    .filter(([, v]) => v !== '' && v !== false)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return JSON.stringify([line.productId, line.variationId ?? 0, entries]);
}
