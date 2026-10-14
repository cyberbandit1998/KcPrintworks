import type { RatingSummary as Rating } from '@kcpw/contracts/client';
import { Stars } from './Stars';

/** WooCommerce's average and number of approved ratings, as a link down to the reviews. Shown only when there is at least one. */
export function RatingSummary({ rating }: { rating: Rating | undefined }) {
  if (!rating) return null;
  const average = Number.isInteger(rating.average)
    ? rating.average.toFixed(1)
    : String(rating.average);
  return (
    <p className="rating-summary">
      <a href="#reviews">
        <Stars value={rating.average} spoken={false} />
        <span>
          {average} out of 5 ({rating.count} {rating.count === 1 ? 'review' : 'reviews'})
        </span>
      </a>
    </p>
  );
}
