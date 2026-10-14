<?php
declare(strict_types=1);

namespace KcPrintworks\Core\Tests;

use KcPrintworks\Core\Reviews\ReviewGateway;
use KcPrintworks\Core\Wp\WcReviewGateway;

/**
 * The WordPress/WooCommerce side of reviews against stand-ins. It proves what THIS code asks of WordPress; that WordPress and
 * WooCommerce answer that way is proven by the staging checklist (docs/REVIEWS-STAGING-CHECKLIST.md).
 */
final class WcReviewGatewayTest extends TestCase
{
    private function gateway(): WcReviewGateway
    {
        \WpStub::reset();
        return new WcReviewGateway();
    }

    public function testReviewsNeedBothWooCommerceSwitches(): void
    {
        $gateway = $this->gateway();
        $this->assertTrue($gateway->reviewsEnabled(), 'WooCommerce defaults are yes');
        \WpStub::$options['woocommerce_enable_reviews'] = 'no';
        $this->assertFalse($gateway->reviewsEnabled());
        \WpStub::$options = ['woocommerce_enable_review_rating' => 'no'];
        $this->assertFalse($gateway->reviewsEnabled(), 'a form that needs a rating is closed when ratings are off');
    }

    public function testOnlyAPublishedTopLevelProductThatAllowsReviewsIsOpen(): void
    {
        $gateway = $this->gateway();
        $this->assertSame(ReviewGateway::PRODUCT_UNKNOWN, $gateway->productState(10));
        $open = GlueFixtures::product(10, 'Open');
        $this->assertSame(ReviewGateway::PRODUCT_OPEN, $gateway->productState(10));
        $open->reviewsAllowed = false;
        $this->assertSame(ReviewGateway::PRODUCT_CLOSED, $gateway->productState(10));
        $draft = GlueFixtures::product(11, 'Draft');
        $draft->status = 'draft';
        $this->assertSame(ReviewGateway::PRODUCT_UNKNOWN, $gateway->productState(11));
        $variation = GlueFixtures::product(12, 'Variation');
        $variation->type = 'variation';
        $this->assertSame(ReviewGateway::PRODUCT_UNKNOWN, $gateway->productState(12));
    }

    public function testVerifiedOwnersOnlyFollowsWooCommerceAndOwnershipIsWooCommercesAnswer(): void
    {
        $gateway = $this->gateway();
        $this->assertFalse($gateway->verifiedOwnersOnly());
        \WpStub::$options['woocommerce_review_rating_verification_required'] = 'yes';
        $this->assertTrue($gateway->verifiedOwnersOnly());
        \WpStub::$bought[] = ['buyer@example.com', 10];
        $this->assertTrue($gateway->isVerifiedOwner('buyer@example.com', 10));
        $this->assertFalse($gateway->isVerifiedOwner('buyer@example.com', 11));
        $this->assertFalse($gateway->isVerifiedOwner('other@example.com', 10));
    }

    public function testAnExistingApprovedOrWaitingReviewByTheEmailCounts(): void
    {
        $gateway = $this->gateway();
        $this->assertFalse($gateway->hasReview(10, 'a@example.com'));
        \WpStub::$existingComments[] = ['post' => 10, 'email' => 'a@example.com', 'status' => 'hold'];
        \WpStub::$existingComments[] = ['post' => 10, 'email' => 'b@example.com', 'status' => 'trash'];
        $this->assertTrue($gateway->hasReview(10, 'a@example.com'));
        $this->assertFalse($gateway->hasReview(11, 'a@example.com'));
        $this->assertFalse($gateway->hasReview(10, 'b@example.com'), 'a trashed review does not block a new one');
    }

    public function testAttemptsAreCountedInAWindowAndNothingReadableIsStored(): void
    {
        $gateway = $this->gateway();
        $this->assertSame(0, $gateway->attempts('c:abc'));
        $gateway->recordAttempt('c:abc', 3600);
        $gateway->recordAttempt('c:abc', 3600);
        $this->assertSame(2, $gateway->attempts('c:abc'));
        $this->assertSame(0, $gateway->attempts('c:other'));
        foreach (array_keys(\WpStub::$transients) as $name) {
            $this->assertTrue(preg_match('/^kcpw_rv_[0-9a-f]{32}$/', $name) === 1, 'the stored name is a hash');
        }
        // Past the window the count starts again.
        \WpStub::$transients[array_key_first(\WpStub::$transients)]['until'] = time() - 1;
        $this->assertSame(0, $gateway->attempts('c:abc'));
    }

    public function testASavedReviewIsPendingWhateverTheSiteSettingsAndCarriesItsRating(): void
    {
        $gateway = $this->gateway();
        $id = $gateway->insertPending(10, 4, 'Robin Hood', 'robin@example.com', 'A really lovely case.');
        $this->assertSame(501, $id);
        $comment = \WpStub::$newComments[501];
        $this->assertSame(0, $comment['approved'], 'held for a person even though the stand-in site would auto-approve');
        $this->assertSame('review', $comment['comment_type']);
        $this->assertSame(10, $comment['comment_post_ID']);
        $this->assertSame('Robin Hood', $comment['comment_author']);
        $this->assertSame('robin@example.com', $comment['comment_author_email']);
        $this->assertSame('A really lovely case.', $comment['comment_content']);
        $this->assertSame(0, $comment['user_id']);
        $this->assertTrue($comment['wpError'], 'errors come back as errors, not as a dead page');
        $this->assertFalse($comment['floodCheck'], 'WordPress’s per-address flood check is off; ReviewService limits floods');
        $this->assertTrue(\WpStub::$slashCalls >= 1, 'wp_new_comment expects slashed data');
        $this->assertSame(4, \WpStub::$commentMeta[501]['rating']);
        $this->assertSame(['pre_comment_approved', 'comment_flood_filter'], \WpStub::$removedFilters, 'the temporary filters are removed again');
        $this->assertSame([], \WpStub::$filters['pre_comment_approved'] ?? []);
    }

    public function testSpamAndTrashVerdictsFromTheSiteAreLeftAloneAndOnlyApprovalIsHeldBack(): void
    {
        $gateway = $this->gateway();
        \WpStub::$initialApproval = 'spam';
        $gateway->insertPending(10, 5, 'Robin Hood', 'robin@example.com', 'A really lovely case.');
        $this->assertSame('spam', \WpStub::$newComments[501]['approved'], 'a spam verdict stays a spam verdict');
        \WpStub::$initialApproval = 'trash';
        $gateway->insertPending(10, 5, 'Robin Hood', 'robin2@example.com', 'A really lovely case.');
        $this->assertSame('trash', \WpStub::$newComments[502]['approved']);
        \WpStub::$initialApproval = 0;
        $gateway->insertPending(10, 5, 'Robin Hood', 'robin3@example.com', 'A really lovely case.');
        $this->assertSame(0, \WpStub::$newComments[503]['approved']);
    }

    public function testVerifiedIsWooCommercesOwnCallAndIsOnlyFilledInIfItDidNot(): void
    {
        $gateway = $this->gateway();
        \WpStub::$bought[] = ['robin@example.com', 10];
        $gateway->insertPending(10, 5, 'Robin Hood', 'robin@example.com', 'A really lovely case.');
        $this->assertSame(1, \WpStub::$commentMeta[501]['verified'], 'the same WooCommerce check, made server-side from the email');
        $gateway->insertPending(10, 5, 'Someone Else', 'someone@example.com', 'Another really lovely case.');
        $this->assertSame(0, \WpStub::$commentMeta[502]['verified']);
    }

    public function testADuplicateAndAFailureAreTold(): void
    {
        $gateway = $this->gateway();
        \WpStub::$newCommentError = new \WP_Error('comment_duplicate', 'Duplicate comment detected');
        $this->assertSame(ReviewGateway::DUPLICATE, $gateway->insertPending(10, 5, 'Robin Hood', 'robin@example.com', 'A really lovely case.'));
        \WpStub::$newCommentError = new \WP_Error('db_insert_error', 'nope');
        $this->assertSame(0, $gateway->insertPending(10, 5, 'Robin Hood', 'robin@example.com', 'A really lovely case.'));
        $this->assertSame([], \WpStub::$filters['pre_comment_approved'] ?? [], 'filters are removed even when the save fails');
        $this->assertSame([], \WpStub::$commentMeta);
    }
}
