import { NextResponse } from 'next/server';
import { QuoteRequestSchema } from '@kcpw/contracts';
import { getCatalog } from '@/lib/catalog';
import { buildQuote } from '@/lib/quote-server';

const MAX_BODY_BYTES = 32_000;

/**
 * Cart quote for DISPLAY: prices the lines from the catalog this storefront is showing (WooCommerce data when
 * CATALOG_SOURCE=woo, at most a couple of minutes old). The authoritative check is made by kcpw-core on the shop host when
 * the shopper presses Checkout (/api/cart/handoff/). The browser only ever sends line intents; unknown fields (such as a
 * price) are rejected.
 */
export async function POST(request: Request) {
  const length = Number(request.headers.get('content-length') ?? '0');
  if (length > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: 'payload_too_large' },
      { status: 413, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'invalid_json' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const parsed = QuoteRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'invalid_request',
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const response = await buildQuote(getCatalog(), parsed.data.lines, parsed.data.coupon);
  return NextResponse.json(response, { headers: { 'Cache-Control': 'no-store' } });
}
