import type { Product } from '@kcpw/contracts/client';
import { issueFormToken } from '@/lib/reviews/form-token';
import { currentReviewSubmitStatus } from '@/lib/reviews/submit-config';
import { ReviewForm } from './ReviewForm';

/**
 * The "write a review" form, only when an operator has switched review submission on (REVIEWS_SUBMIT_ENABLED, with the shop address and
 * the shared secret) and WooCommerce has reviews switched on for this product. Otherwise nothing is drawn, and no script is sent for it.
 */
export function ReviewFormSection({
  product,
}: {
  product: Pick<Product, 'id' | 'reviewsAllowed'>;
}) {
  if (!product.reviewsAllowed) return null;
  const status = currentReviewSubmitStatus();
  if (!status.enabled) return null;
  return (
    <section className="review-form-section" aria-labelledby="write-review-heading">
      <h3 id="write-review-heading">Write a review</h3>
      <ReviewForm productId={product.id} token={issueFormToken(status.config.secret, product.id)} />
    </section>
  );
}
