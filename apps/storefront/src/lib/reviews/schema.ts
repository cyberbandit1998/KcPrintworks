import { z } from 'zod';

/**
 * One row of WooCommerce's PUBLIC Store API (GET /wp-json/wc/store/v1/products/reviews). It lists approved reviews only and carries
 * no email address. Not strict: WooCommerce and its extensions add fields freely.
 */
export const StoreReviewSchema = z.object({
  id: z.number().int(),
  date_created_gmt: z.string().nullish(),
  date_created: z.string().nullish(),
  product_id: z.number().int(),
  product_name: z.string().optional(),
  reviewer: z.string().nullish(),
  review: z.string().nullish(),
  rating: z.number().nullish(),
  verified: z.boolean().optional(),
});
export type StoreReview = z.infer<typeof StoreReviewSchema>;
