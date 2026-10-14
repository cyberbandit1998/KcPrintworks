import { NextResponse } from 'next/server';
import { getCatalog } from '@/lib/catalog';
import { NO_STORE } from '@/lib/http';
import { RateLimiter } from '@/lib/reviews/rate-limit';
import { currentReviewSubmitStatus } from '@/lib/reviews/submit-config';
import { handleReviewSubmission } from '@/lib/reviews/submit-handler';

export const dynamic = 'force-dynamic';

/**
 * Reviews per visitor and for the whole shop, per ten minutes (REVIEWS_RATE_LIMIT, default 3; REVIEWS_RATE_LIMIT_ALL, default 60).
 * Kept on globalThis: one limiter, however the route is bundled.
 */
const KEY = Symbol.for('kcpw.reviewLimiters');
type Holder = typeof globalThis & {
  [KEY]?: { perClient: RateLimiter; overall: RateLimiter };
};
const limit = (name: string, fallback: number) => {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value >= 1 && value <= 100_000 ? value : fallback;
};

function limiters() {
  const holder = globalThis as Holder;
  return (holder[KEY] ??= {
    perClient: new RateLimiter(limit('REVIEWS_RATE_LIMIT', 3), 10 * 60_000),
    overall: new RateLimiter(limit('REVIEWS_RATE_LIMIT_ALL', 60), 10 * 60_000),
  });
}

export async function POST(request: Request) {
  const { perClient, overall } = limiters();
  const reply = await handleReviewSubmission(request, {
    status: currentReviewSubmitStatus(),
    productAcceptsReviews: async (productId) => {
      const products = await getCatalog().listProducts();
      return products.some((p) => p.id === productId && p.reviewsAllowed);
    },
    perClient,
    overall,
    log: (line) => console.error(line),
  });
  return NextResponse.json(reply.body, {
    status: reply.status,
    headers: { ...NO_STORE, ...reply.headers },
  });
}
