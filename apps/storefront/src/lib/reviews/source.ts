import { KeyedSwrCache, registerContentCache } from '../content-cache';
import type { WpClient } from '../wp/client';
import { WpError } from '../wp/client';
import { toReview } from './convert';
import { StoreReviewSchema } from './schema';
import type { Review, ReviewPage, ReviewsSource } from './types';

export interface ReviewsContent extends ReviewsSource {
  cache: KeyedSwrCache;
}

function parse(data: unknown): Review[] {
  if (!Array.isArray(data)) throw new WpError('WooCommerce returned an unexpected answer');
  const reviews: Review[] = [];
  for (const raw of data) {
    const row = StoreReviewSchema.safeParse(raw);
    const review = row.success ? toReview(row.data) : null;
    if (review) reviews.push(review);
  }
  return reviews;
}

/** The newest reviews are fetched in one request and filtered here, so a rating filter never costs another call. */
const LATEST_FETCH = 24;

/**
 * Approved reviews from WooCommerce's public Store API (no credential is sent or needed), cached like the blog: a visitor is served
 * from memory, a stale answer is refreshed once in the background, a failing shop keeps serving the last good copy, and the signed
 * refresh makes the next view load again.
 */
export function createReviewsSource(deps: {
  client: WpClient;
  ttlSeconds: number;
  register?: boolean;
  now?: () => number;
}): ReviewsContent {
  const cache = new KeyedSwrCache({ ttlMs: deps.ttlSeconds * 1000, maxEntries: 300 }, deps.now);
  if (deps.register !== false) registerContentCache(cache);

  return {
    cache,

    forProduct(productId, page, perPage): Promise<ReviewPage> {
      return cache.get(`reviews:${productId}:${page}:${perPage}`, async () => {
        try {
          const result = await deps.client.get('/products/reviews', {
            product_id: productId,
            per_page: perPage,
            page,
            orderby: 'date_gmt',
            order: 'desc',
          });
          return {
            reviews: parse(result.data),
            total: result.total,
            pages: result.totalPages,
            page,
          };
        } catch (error) {
          if (error instanceof WpError && error.status === 400) {
            return { reviews: [], total: 0, pages: 0, page };
          }
          throw error;
        }
      });
    },

    async latest(limit, minRating = 1): Promise<Review[]> {
      const all = await cache.get('reviews:latest', async () => {
        const result = await deps.client.get('/products/reviews', {
          per_page: LATEST_FETCH,
          page: 1,
          orderby: 'date_gmt',
          order: 'desc',
        });
        return parse(result.data);
      });
      return all.filter((review) => review.rating >= minRating).slice(0, limit);
    },
  };
}
