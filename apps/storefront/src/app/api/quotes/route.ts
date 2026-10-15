import { NextResponse } from 'next/server';
import { NO_STORE } from '@/lib/http';
import { RateLimiter } from '@/lib/reviews/rate-limit';
import { currentQuotesStatus } from '@/lib/quotes/config';
import { handleQuoteSubmission } from '@/lib/quotes/submit-handler';

export const dynamic = 'force-dynamic';

/**
 * Quote requests per visitor and for the whole shop, per hour (QUOTES_RATE_LIMIT, default 4; QUOTES_RATE_LIMIT_ALL, default 60).
 * Kept on globalThis: one limiter, however the route is bundled.
 */
const KEY = Symbol.for('kcpw.quoteLimiters');
type Holder = typeof globalThis & { [KEY]?: { perClient: RateLimiter; overall: RateLimiter } };
const limit = (name: string, fallback: number) => {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value >= 1 && value <= 100_000 ? value : fallback;
};

function limiters() {
  const holder = globalThis as Holder;
  return (holder[KEY] ??= {
    perClient: new RateLimiter(limit('QUOTES_RATE_LIMIT', 4), 60 * 60_000),
    overall: new RateLimiter(limit('QUOTES_RATE_LIMIT_ALL', 60), 60 * 60_000),
  });
}

export async function POST(request: Request) {
  const { perClient, overall } = limiters();
  const reply = await handleQuoteSubmission(request, {
    status: currentQuotesStatus(),
    perClient,
    overall,
    log: (line) => console.error(line),
  });
  return NextResponse.json(reply.body, {
    status: reply.status,
    headers: { ...NO_STORE, ...reply.headers },
  });
}
