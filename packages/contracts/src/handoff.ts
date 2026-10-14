import { z } from 'zod';
import { CartLineIntentSchema, QuoteIssueSchema } from './cart';
import { MAX_CART_LINES } from './cart-logic';

/**
 * Cart handoff, browser <-> storefront server (ADR-002, docs/PAYMENTS-STRIPE.md section 4).
 *
 * The browser sends line INTENTS only. `.strict()` rejects a price, a total, or anything else unexpected. The storefront
 * server adds nothing the shopper can influence (it computes its own expected subtotal), signs the request, and asks
 * kcpw-core on the shop host, which validates against WooCommerce and mints a single-use checkout URL.
 */
export const HandoffRequestSchema = z
  .object({ lines: z.array(CartLineIntentSchema).min(1).max(MAX_CART_LINES) })
  .strict();
export type HandoffRequest = z.infer<typeof HandoffRequestSchema>;

/** Why a handoff did not produce a checkout URL. The cart page words each one for the shopper. */
export const HANDOFF_ERRORS = [
  'checkout_disabled',
  'invalid_request',
  'invalid_lines',
  'changed',
  'unavailable',
] as const;
export type HandoffErrorCode = (typeof HANDOFF_ERRORS)[number];

export const HandoffSuccessSchema = z.object({
  ok: z.literal(true),
  redirectUrl: z.string().url(),
});
export const HandoffFailureSchema = z.object({
  ok: z.literal(false),
  error: z.enum(HANDOFF_ERRORS),
  /** Per-line problems, by position in the request, when the error is about the lines. */
  lines: z
    .array(z.object({ index: z.number().int().nonnegative(), issues: z.array(QuoteIssueSchema) }))
    .optional(),
});
export const HandoffResponseSchema = z.discriminatedUnion('ok', [
  HandoffSuccessSchema,
  HandoffFailureSchema,
]);
export type HandoffResponse = z.infer<typeof HandoffResponseSchema>;
