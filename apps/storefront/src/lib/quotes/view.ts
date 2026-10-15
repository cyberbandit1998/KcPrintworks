import { z } from 'zod';
import { QUOTE_REF, QUOTE_TOKEN, type QuoteView } from './api-types';
import type { QuotesConfig } from './config';
import { safePayUrl } from './pay-url';
import { callQuotesPlugin, whyUnavailable } from './upstream';

/**
 * What a private quote link shows, from the plugin. The answer is parsed against a strict shape and anything else is treated as "the
 * link did not work": a malformed answer must never be rendered. The payment address is checked against the shop before it is kept.
 */
const ViewSchema = z
  .object({
    ok: z.literal(true),
    state: z.enum(['open', 'approved', 'paid', 'expired', 'closed']),
    ref: z.string().regex(QUOTE_REF),
    firstName: z.string().max(80),
    project: z.string().max(80),
    quantity: z.number().int().min(1).max(1000),
    title: z.string().max(200),
    details: z.string().max(4100),
    itemCents: z.number().int().min(0).max(5_000_000),
    shipCents: z.number().int().min(0).max(5_000_000),
    totalCents: z.number().int().min(0).max(10_000_000),
    currency: z.string().regex(/^[A-Z]{3}$/),
    taxable: z.boolean(),
    revision: z.number().int().min(0).max(100_000),
    expiresAt: z.number().int().min(0),
    payBy: z.number().int().min(0),
    payUrl: z.string().optional(),
  })
  .strip();

export type ViewResult =
  { kind: 'ok'; view: QuoteView } | { kind: 'invalid_link' } | { kind: 'unavailable' };

/** True when the reference and token have the right shape. A link that does not is answered without bothering the shop. */
export function wellFormedLink(ref: string, token: string): boolean {
  return QUOTE_REF.test(ref) && QUOTE_TOKEN.test(token);
}

export async function fetchQuoteView(
  config: QuotesConfig,
  ref: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
  log: (line: string) => void = (line) => console.error(line),
): Promise<ViewResult> {
  if (!wellFormedLink(ref, token)) return { kind: 'invalid_link' };
  const answer = await callQuotesPlugin(
    config,
    '/kcpw-quotes/v1/quote/view',
    { ref, token },
    fetchImpl,
  );
  if (!answer.reached) {
    log(`[quotes] quote link not shown: ${answer.why}`);
    return { kind: 'unavailable' };
  }
  if (answer.status === 404) return { kind: 'invalid_link' };
  const parsed = ViewSchema.safeParse(answer.json);
  if (answer.status !== 200 || !parsed.success) {
    log(
      `[quotes] quote link not shown: ${answer.status === 200 ? 'the shop answered in an unexpected shape' : whyUnavailable(answer.status)}`,
    );
    return { kind: 'unavailable' };
  }
  const { payUrl, ...rest } = parsed.data;
  const { ok: _ok, ...view } = rest;
  void _ok;
  const safe = payUrl === undefined ? undefined : safePayUrl(payUrl, config.apiUrl);
  return { kind: 'ok', view: { ...view, ...(safe ? { payUrl: safe } : {}) } };
}
