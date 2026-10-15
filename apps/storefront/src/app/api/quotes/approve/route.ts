import { NextResponse } from 'next/server';
import { NO_STORE } from '@/lib/http';
import { isProduction, siteUrl } from '@/lib/env';
import { RateLimiter } from '@/lib/reviews/rate-limit';
import { currentQuotePaymentStatus } from '@/lib/quotes/config';
import { handleQuoteApproval } from '@/lib/quotes/approve-handler';

export const dynamic = 'force-dynamic';

/** Approvals per visitor and for the whole shop, per hour (QUOTES_APPROVE_RATE_LIMIT, default 20; QUOTES_APPROVE_RATE_LIMIT_ALL, default 200). */
const KEY = Symbol.for('kcpw.quoteApproveLimiters');
type Holder = typeof globalThis & { [KEY]?: { perClient: RateLimiter; overall: RateLimiter } };
const limit = (name: string, fallback: number) => {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value >= 1 && value <= 100_000 ? value : fallback;
};

function limiters() {
  const holder = globalThis as Holder;
  return (holder[KEY] ??= {
    perClient: new RateLimiter(limit('QUOTES_APPROVE_RATE_LIMIT', 20), 60 * 60_000),
    overall: new RateLimiter(limit('QUOTES_APPROVE_RATE_LIMIT_ALL', 200), 60 * 60_000),
  });
}

export async function POST(request: Request) {
  const { perClient, overall } = limiters();
  const reply = await handleQuoteApproval(request, {
    status: currentQuotePaymentStatus(),
    perClient,
    overall,
    guard: { production: isProduction, siteUrl },
    log: (line) => console.error(line),
  });
  return NextResponse.json(reply.body, {
    status: reply.status,
    headers: { ...NO_STORE, ...reply.headers },
  });
}
