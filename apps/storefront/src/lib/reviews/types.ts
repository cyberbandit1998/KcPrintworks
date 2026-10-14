/**
 * An APPROVED customer review as WooCommerce publishes it. Nothing here is computed or invented: a review is shown exactly as a
 * customer wrote it (name shortened), with the rating they gave, and "verified" only when WooCommerce itself says so.
 */
export interface Review {
  id: number;
  productId: number;
  /** The product the review is about, for the home page where reviews from many products are listed. */
  productName: string;
  /** "Jane D." Never an email address. */
  author: string;
  /** 1 to 5, whole stars. */
  rating: number;
  /** Plain text paragraphs (no markup). */
  paragraphs: string[];
  /** ISO time, UTC. */
  publishedAt: string;
  /** True only when WooCommerce marked the review as from a verified owner (a real purchase it can match). */
  verified: boolean;
}

export interface ReviewPage {
  reviews: Review[];
  total: number;
  pages: number;
  page: number;
}

export interface ReviewsSource {
  /** Approved reviews of one product, newest first. */
  forProduct(productId: number, page: number, perPage: number): Promise<ReviewPage>;
  /** The newest approved reviews of the whole shop. */
  latest(limit: number, minRating?: number): Promise<Review[]>;
}
