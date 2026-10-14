<?php
declare(strict_types=1);

namespace KcPrintworks\Core\Wp;

use KcPrintworks\Core\Reviews\ReviewGateway;

/**
 * The WordPress and WooCommerce side of review submission. It writes exactly one thing: a PENDING review (a WordPress comment of type
 * "review" with its star rating) through WordPress's own comment pipeline, so the site's spam checks, blocklist, and moderation
 * notification behave as they do for any review. It never touches a product.
 *
 * What is NOT proven by this plugin's tests: they use stand-ins for WordPress and WooCommerce. The behavior against the real
 * thing is proven by the staging checklist (docs/REVIEWS-STAGING-CHECKLIST.md): submit one test review, see it waiting in
 * Products > Reviews with its rating, then trash it.
 */
final class WcReviewGateway implements ReviewGateway
{
    public function reviewsEnabled(): bool
    {
        return get_option('woocommerce_enable_reviews', 'yes') === 'yes'
            && get_option('woocommerce_enable_review_rating', 'yes') === 'yes';
    }

    public function productState(int $productId): string
    {
        if (!function_exists('wc_get_product')) {
            return self::PRODUCT_UNKNOWN;
        }
        $product = wc_get_product($productId);
        // Only a published, top-level product: never a variation, a draft, or something else with an id.
        if (!$product || $product->get_status() !== 'publish' || $product->get_type() === 'variation') {
            return self::PRODUCT_UNKNOWN;
        }
        return $product->get_reviews_allowed() ? self::PRODUCT_OPEN : self::PRODUCT_CLOSED;
    }

    public function verifiedOwnersOnly(): bool
    {
        return get_option('woocommerce_review_rating_verification_required', 'no') === 'yes';
    }

    public function isVerifiedOwner(string $email, int $productId): bool
    {
        return function_exists('wc_customer_bought_product') && (bool) wc_customer_bought_product($email, 0, $productId);
    }

    public function hasReview(int $productId, string $email): bool
    {
        $found = get_comments([
            'post_id' => $productId,
            'author_email' => $email,
            'type__in' => ['review', 'comment'],
            'status' => ['approve', 'hold'],
            'count' => true,
        ]);
        return (int) $found > 0;
    }

    public function attempts(string $key): int
    {
        $entry = get_transient($this->transientName($key));
        if (!is_array($entry) || !isset($entry['n'], $entry['until']) || (int) $entry['until'] < time()) {
            return 0;
        }
        return (int) $entry['n'];
    }

    public function recordAttempt(string $key, int $windowSeconds): void
    {
        $name = $this->transientName($key);
        $entry = get_transient($name);
        $now = time();
        if (!is_array($entry) || !isset($entry['n'], $entry['until']) || (int) $entry['until'] < $now) {
            $entry = ['n' => 0, 'until' => $now + $windowSeconds];
        }
        $entry['n'] = (int) $entry['n'] + 1;
        set_transient($name, $entry, max(1, (int) $entry['until'] - $now));
    }

    public function insertPending(int $productId, int $rating, string $name, string $email, string $text): int
    {
        // Whatever Settings > Discussion says, this review waits for a person. Spam and trash verdicts are left alone.
        $hold = static fn (mixed $approved): mixed => ($approved === 'spam' || $approved === 'trash') ? $approved : 0;
        // WordPress's "too many comments too fast" check keys on the sender's address, which here is always this storefront.
        // Flooding is limited by ReviewService per client, per email, and overall instead.
        $noFlood = static fn (): bool => false;
        add_filter('pre_comment_approved', $hold, 99, 2);
        add_filter('comment_flood_filter', $noFlood, 99, 3);
        try {
            $id = wp_new_comment(wp_slash([
                'comment_post_ID' => $productId,
                'comment_author' => $name,
                'comment_author_email' => $email,
                'comment_author_url' => '',
                'comment_content' => $text,
                'comment_type' => 'review',
                'comment_parent' => 0,
                'user_id' => 0,
                'comment_agent' => 'KCPrintWorks storefront',
            ]), true);
        } finally {
            remove_filter('pre_comment_approved', $hold, 99);
            remove_filter('comment_flood_filter', $noFlood, 99);
        }
        if (is_wp_error($id)) {
            return $id->get_error_code() === 'comment_duplicate' ? self::DUPLICATE : 0;
        }
        $id = (int) $id;
        if ($id < 1) {
            return 0;
        }
        update_comment_meta($id, 'rating', $rating);
        // WooCommerce records "verified" itself when the review is saved, from the email address. Only if it did not (an older
        // WooCommerce), the same WooCommerce check is made here; nothing from the request is ever used.
        if (get_comment_meta($id, 'verified', true) === '') {
            update_comment_meta($id, 'verified', $this->isVerifiedOwner($email, $productId) ? 1 : 0);
        }
        return $id;
    }

    private function transientName(string $key): string
    {
        return 'kcpw_rv_' . substr(hash('sha256', $key), 0, 32);
    }
}
