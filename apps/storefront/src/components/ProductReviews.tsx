import type { Product } from '@kcpw/contracts/client';
import type { ReviewPage } from '@/lib/reviews/types';
import { Pagination } from './Pagination';
import { ReviewCard } from './ReviewCard';

/**
 * The reviews on a product page: only APPROVED reviews that WooCommerce publishes, newest first. Nothing is shown for a product that
 * has reviews switched off in WooCommerce. `result` is null when WooCommerce could not be reached in time: the section then says so.
 */
export function ProductReviews({
  product,
  result,
  children,
}: {
  product: Pick<Product, 'slug' | 'rating' | 'reviewsAllowed'>;
  result: ReviewPage | null;
  /** The "write a review" form, when reviews can be submitted. */
  children?: React.ReactNode;
}) {
  if (!product.reviewsAllowed) return null;
  const { rating } = product;
  return (
    <section
      id="reviews"
      className="container reviews"
      aria-labelledby="reviews-heading"
      tabIndex={-1}
    >
      <h2 id="reviews-heading">Customer reviews</h2>
      {rating ? (
        <p className="reviews__note">
          {rating.average.toFixed(1)} out of 5, from {rating.count}{' '}
          {rating.count === 1 ? 'rating' : 'ratings'}.
        </p>
      ) : null}
      {result === null ? (
        <p role="status">Reviews are not available right now. Please try again in a few minutes.</p>
      ) : result.reviews.length === 0 ? (
        <p>{rating ? 'There are no written reviews to show yet.' : 'There are no reviews yet.'}</p>
      ) : (
        <>
          <ul className="review-list">
            {result.reviews.map((review) => (
              <li key={review.id}>
                <ReviewCard review={review} />
              </li>
            ))}
          </ul>
          <Pagination
            path={`/product/${product.slug}/`}
            page={result.page}
            pages={result.pages}
            pageParam="review_page"
            hash="#reviews"
          />
        </>
      )}
      {children}
    </section>
  );
}
