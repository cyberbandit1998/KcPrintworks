import { NextResponse } from 'next/server';
import { HandoffRequestSchema, type HandoffResponse } from '@kcpw/contracts';
import { getCatalog, refreshCatalog } from '@/lib/catalog';
import { buildQuote } from '@/lib/quote-server';
import { currentCheckoutStatus } from '@/lib/checkout';
import { NO_STORE, readBodyLimited } from '@/lib/http';
import { requestHandoff } from '@/lib/handoff/upstream';
import { checkShop } from '@/lib/handoff/shop-guard';
import { isProduction, siteUrl } from '@/lib/env';

/**
 * "Take me to checkout." The browser sends line intents; this server (never the browser) asks kcpw-core on the shop host,
 * which validates every line against WooCommerce and returns a single-use checkout link. Prices are never read from the
 * request. This route re-checks that checkout is switched on, because the button being visible proves nothing, and asks the shop
 * who it is (handoff/shop-guard.ts) so a staging build cannot reach a shop in live Stripe mode.
 */
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 32_000;

const reply = (body: HandoffResponse, status: number) =>
  NextResponse.json(body, { status, headers: NO_STORE });

export async function POST(request: Request) {
  const checkout = currentCheckoutStatus();
  if (!checkout.enabled) return reply({ ok: false, error: 'checkout_disabled' }, 403);

  const raw = await readBodyLimited(request, MAX_BODY_BYTES);
  if (raw === null) return reply({ ok: false, error: 'invalid_request' }, 413);
  let body: unknown;
  try {
    body = JSON.parse(raw.toString('utf8'));
  } catch {
    return reply({ ok: false, error: 'invalid_request' }, 400);
  }
  const parsed = HandoffRequestSchema.safeParse(body);
  if (!parsed.success) return reply({ ok: false, error: 'invalid_request' }, 400);

  // What this server believes the cart costs. If it already sees a problem there is no reason to bother the shop.
  let quote;
  try {
    quote = await buildQuote(getCatalog(), parsed.data.lines);
  } catch {
    return reply({ ok: false, error: 'unavailable' }, 503);
  }
  const problems = quote.lines
    .map((line, index) => ({ index, issues: line.issues }))
    .filter((line) => line.issues.length > 0);
  if (problems.length > 0)
    return reply({ ok: false, error: 'invalid_lines', lines: problems }, 422);

  const shop = await checkShop(checkout.config, { production: isProduction, siteUrl });
  if (!shop.ok) {
    console.error(`[checkout] handoff refused (${shop.kind}): ${shop.why}`);
    return shop.kind === 'unreachable'
      ? reply({ ok: false, error: 'unavailable' }, 503)
      : reply({ ok: false, error: 'checkout_disabled' }, 403);
  }

  const result = await requestHandoff(checkout.config, parsed.data.lines, quote.subtotal.amount);
  switch (result.kind) {
    case 'ok':
      return reply({ ok: true, redirectUrl: result.redirectUrl }, 200);
    case 'invalid_lines':
      return reply(
        {
          ok: false,
          error: 'invalid_lines',
          lines: result.lines.map((line) => ({
            index: line.index,
            issues: line.issues.map((issue) => ({
              code: knownCode(issue.code),
              message: issue.message,
              ...(issue.field ? { field: issue.field } : {}),
            })),
          })),
        },
        422,
      );
    case 'changed':
      // WooCommerce and this page disagree: our catalog is behind. Load fresh data now so the next look is right.
      refreshCatalog();
      return reply({ ok: false, error: 'changed' }, 409);
    case 'invalid_request':
      return reply({ ok: false, error: 'invalid_request' }, 400);
    case 'unavailable':
      // Operators see why in the server log; shoppers get a plain "try again". Nothing here contains a secret.
      console.error(`[checkout] handoff unavailable: ${result.why}`);
      return reply({ ok: false, error: 'unavailable' }, 503);
  }
}

const CODES = [
  'unknown_product',
  'unavailable',
  'invalid_variation',
  'out_of_stock',
  'quantity_limit',
  'invalid_option',
  'coupon_invalid',
] as const;
function knownCode(code: string): (typeof CODES)[number] {
  return (CODES as readonly string[]).includes(code)
    ? (code as (typeof CODES)[number])
    : 'unavailable';
}
