import { catalogSourceName } from '../env';
import { createWpClient } from '../wp/client';
import { readWpConfig } from '../wp/config';
import { createFixtureReviewsClient } from './fixture-client';
import { createReviewsSource, type ReviewsContent } from './source';
import type { Review, ReviewPage } from './types';

export type { Review, ReviewPage } from './types';

const STORE_API = '/wp-json/wc/store/v1';
const GLOBAL_KEY = Symbol.for('kcpw.reviewsSource');
type Holder = typeof globalThis & { [GLOBAL_KEY]?: ReviewsContent | null };

/** One reviews source per server process (see lib/wp/index.ts for why it lives on globalThis). Null when WooCommerce is not set up. */
function getReviewsService(): ReviewsContent | null {
  const holder = globalThis as Holder;
  if (holder[GLOBAL_KEY] !== undefined) return holder[GLOBAL_KEY];
  let created: ReviewsContent | null;
  if (catalogSourceName === 'woo') {
    const read = readWpConfig();
    created = read.ok
      ? createReviewsSource({
          client: createWpClient(read.config, fetch, STORE_API),
          ttlSeconds: read.config.ttlSeconds,
        })
      : null;
  } else {
    created = createReviewsSource({ client: createFixtureReviewsClient(), ttlSeconds: 120 });
  }
  holder[GLOBAL_KEY] = created;
  return created;
}

export const REVIEWS_PER_PAGE = 10;

/** Approved reviews of one product. Rejects when WooCommerce cannot be reached and nothing was kept from before. */
export async function productReviews(productId: number, page = 1): Promise<ReviewPage> {
  const service = getReviewsService();
  if (!service) throw new Error('WooCommerce is not configured');
  return service.forProduct(productId, page, REVIEWS_PER_PAGE);
}

export async function latestReviews(limit: number, minRating = 1): Promise<Review[]> {
  const service = getReviewsService();
  if (!service) throw new Error('WooCommerce is not configured');
  return service.latest(limit, minRating);
}

/** The lowest rating the home page shows (HOME_REVIEWS_MIN_RATING, 1 to 5). Default 1: every approved review is eligible. */
export function homeMinRating(env: Record<string, string | undefined> = process.env): number {
  const value = Number(env.HOME_REVIEWS_MIN_RATING);
  return Number.isInteger(value) && value >= 1 && value <= 5 ? value : 1;
}

export function reviewsStatus() {
  const cache = getReviewsService()?.cache;
  return cache ? cache.status() : { entries: 0, failing: 0, lastError: null };
}
