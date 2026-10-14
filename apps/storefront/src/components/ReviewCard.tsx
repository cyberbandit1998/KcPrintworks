import { formatDate } from '@/lib/format-date';
import type { Review } from '@/lib/reviews/types';
import { Stars } from './Stars';

/** One approved review, as the customer wrote it. "Verified purchase" appears only when WooCommerce says the review is from a verified owner. */
export function ReviewCard({ review, product }: { review: Review; product?: React.ReactNode }) {
  return (
    <article className="review">
      <header className="review__head">
        <Stars value={review.rating} />
        <p className="review__who">
          <strong>{review.author}</strong>
          {review.verified ? <span className="badge badge--outline">Verified purchase</span> : null}
        </p>
        <p className="review__meta">
          <time dateTime={review.publishedAt}>{formatDate(review.publishedAt)}</time>
          {product ? <span> · {product}</span> : null}
        </p>
      </header>
      <div className="review__body">
        {review.paragraphs.map((text, index) => (
          <p key={index}>{text}</p>
        ))}
      </div>
    </article>
  );
}
