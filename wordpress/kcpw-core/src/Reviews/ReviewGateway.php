<?php
declare(strict_types=1);

namespace KcPrintworks\Core\Reviews;

/**
 * Everything the review service needs from WordPress and WooCommerce, as an interface so the rules can be tested without either.
 * The real implementation is Wp\WcReviewGateway.
 */
interface ReviewGateway
{
    public const PRODUCT_OPEN = 'open';
    public const PRODUCT_CLOSED = 'closed';
    public const PRODUCT_UNKNOWN = 'unknown';

    /** The insert did not happen because the same review is already there. */
    public const DUPLICATE = -1;

    /** WooCommerce's store-wide settings: reviews enabled AND star ratings enabled. */
    public function reviewsEnabled(): bool;

    /** self::PRODUCT_*: an existing published product that accepts reviews, one that does not, or no such product. */
    public function productState(int $productId): string;

    /** WooCommerce's setting "Reviews can only be left by verified owners". */
    public function verifiedOwnersOnly(): bool;

    /** WooCommerce's own answer to "did this email address buy this product?" (the same check it uses for the Verified badge). */
    public function isVerifiedOwner(string $email, int $productId): bool;

    /** An existing review (approved or waiting) by this email address on this product. */
    public function hasReview(int $productId, string $email): bool;

    /** Attempts counted under this key within the current window. */
    public function attempts(string $key): int;

    public function recordAttempt(string $key, int $windowSeconds): void;

    /**
     * Saves the review as PENDING (never approved, whatever the site's comment settings say). Returns the new comment id, self::DUPLICATE,
     * or 0 when it could not be saved.
     */
    public function insertPending(int $productId, int $rating, string $name, string $email, string $text): int;
}
