import Link from 'next/link';
import type { Review } from '@/lib/reviews/types';
import { ReviewCard } from '../ReviewCard';

/**
 * What customers wrote, newest first, taken straight from WooCommerce's approved reviews. Left out when there are none (or they could not
 * be loaded in time): nothing is made up to fill the space, and no "store rating" is shown because no such number exists in the shop.
 */
export function ReviewsSection({
  reviews,
}: {
  reviews: readonly { review: Review; slug: string }[];
}) {
  if (reviews.length === 0) return null;
  return (
    <section className="section" aria-labelledby="reviews-heading" data-section="reviews">
      <div className="container">
        <div className="section__header">
          <h2 id="reviews-heading">Customer Reviews</h2>
        </div>
        <ul className="review-grid">
          {reviews.map(({ review, slug }) => (
            <li key={review.id}>
              <ReviewCard
                review={review}
                product={<Link href={`/product/${slug}/`}>{review.productName}</Link>}
              />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
