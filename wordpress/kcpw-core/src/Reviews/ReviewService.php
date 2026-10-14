<?php
declare(strict_types=1);

namespace KcPrintworks\Core\Reviews;

/**
 * Takes a customer review from the storefront (already signed and authenticated by the REST layer) and saves it as a PENDING review.
 *
 *  - The request is validated exactly like the storefront does (ReviewInput); anything that claims a status, approval, or "verified" is refused.
 *  - It is NEVER published here: the review waits until a person approves it in WordPress (Products > Reviews).
 *  - "Verified" is WooCommerce's own call, made by WooCommerce from the email address when the review is saved. This service never
 *    accepts or sets it. When the shop requires verified owners, a review from anyone else is refused.
 *  - One review per email address per product: a second one is quietly kept out, and the answer looks the same as a first one so
 *    nobody can use this to find out which email addresses have reviewed what.
 *  - Floods are limited per storefront-supplied client key (a hash; no address is ever sent), per email, and overall.
 */
final class ReviewService
{
    public const WINDOW_SECONDS = 3600;
    public const CLIENT_LIMIT = 5;
    public const EMAIL_LIMIT = 3;
    public const GLOBAL_LIMIT = 120;

    public function __construct(private readonly ReviewGateway $gateway)
    {
    }

    /** @param mixed $body the decoded JSON object */
    public function submit(mixed $body): ReviewResult
    {
        $clientKey = null;
        if ($body instanceof \stdClass) {
            $copy = clone $body;
            if (property_exists($copy, 'clientKey')) {
                $candidate = $copy->clientKey;
                $clientKey = is_string($candidate) && preg_match('/^[0-9a-f]{64}$/D', $candidate) === 1 ? $candidate : null;
                unset($copy->clientKey);
            }
            $body = $copy;
        }
        $validation = ReviewInput::validate($body);
        if (!$validation->ok || $validation->value === null) {
            return new ReviewResult(ReviewResult::INVALID, $validation->issues);
        }
        $review = $validation->value;

        if (!$this->gateway->reviewsEnabled()) {
            return new ReviewResult(ReviewResult::CLOSED);
        }

        // Every attempt that got this far counts, whatever happens next, so probing cannot be done for free.
        $buckets = [
            ['g', self::GLOBAL_LIMIT],
            ['e:' . hash('sha256', $review['email']), self::EMAIL_LIMIT],
        ];
        if ($clientKey !== null) {
            $buckets[] = ['c:' . $clientKey, self::CLIENT_LIMIT];
        }
        $limited = false;
        foreach ($buckets as [$key, $limit]) {
            if ($this->gateway->attempts($key) >= $limit) {
                $limited = true;
            }
        }
        foreach ($buckets as [$key]) {
            $this->gateway->recordAttempt($key, self::WINDOW_SECONDS);
        }
        if ($limited) {
            return new ReviewResult(ReviewResult::RATE_LIMITED);
        }

        $state = $this->gateway->productState($review['productId']);
        if ($state === ReviewGateway::PRODUCT_UNKNOWN) {
            return new ReviewResult(ReviewResult::NOT_FOUND);
        }
        if ($state !== ReviewGateway::PRODUCT_OPEN) {
            return new ReviewResult(ReviewResult::CLOSED);
        }
        if ($this->gateway->verifiedOwnersOnly() && !$this->gateway->isVerifiedOwner($review['email'], $review['productId'])) {
            return new ReviewResult(ReviewResult::VERIFICATION);
        }
        if ($this->gateway->hasReview($review['productId'], $review['email'])) {
            return new ReviewResult(ReviewResult::RECEIVED); // looks the same as a first review, by design
        }

        $id = $this->gateway->insertPending($review['productId'], $review['rating'], $review['name'], $review['email'], $review['review']);
        if ($id === ReviewGateway::DUPLICATE) {
            return new ReviewResult(ReviewResult::RECEIVED);
        }
        return $id > 0 ? new ReviewResult(ReviewResult::RECEIVED) : new ReviewResult(ReviewResult::ERROR);
    }
}
