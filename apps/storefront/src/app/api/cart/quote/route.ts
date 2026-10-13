import { NextResponse } from 'next/server';
import {
  QuoteRequestSchema,
  priceLine,
  zero,
  addMoney,
  type QuoteIssue,
  type QuoteResponse,
} from '@kcpw/contracts';
import { getCatalog } from '@/lib/catalog';

const MAX_BODY_BYTES = 32_000;

/**
 * Cart quote. In Step 1 this prices lines from the fixture catalog using the shared reference logic; in
 * Step 3 it forwards to `kcpw-core` (server-to-server, HMAC-signed) so WooCommerce computes the numbers.
 * Either way the browser only ever sends line intents, and unknown fields (such as a price) are rejected.
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

  const catalog = getCatalog();
  const lines = await Promise.all(
    parsed.data.lines.map(async (intent) =>
      priceLine(await catalog.getProductById(intent.productId), intent),
    ),
  );

  const issues: QuoteIssue[] = [];
  if (parsed.data.coupon) {
    issues.push({ code: 'coupon_invalid', message: 'Coupons are not available in this preview.' });
  }

  const currency = lines[0]?.unitPrice.currency ?? 'USD';
  const subtotal = lines
    .filter((l) => l.issues.length === 0)
    .reduce((sum, l) => addMoney(sum, l.lineTotal), zero(currency));

  const response: QuoteResponse = {
    lines,
    subtotal,
    issues,
    checkoutReady:
      lines.length > 0 && lines.every((l) => l.issues.length === 0) && issues.length === 0,
    note: 'Shipping, tax, and any discounts are calculated at checkout.',
  };
  return NextResponse.json(response, { headers: { 'Cache-Control': 'no-store' } });
}
