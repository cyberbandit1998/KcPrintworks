<?php
declare(strict_types=1);

namespace KcPrintworks\Core\Tests;

use KcPrintworks\Core\Reviews\ReviewGateway;
use KcPrintworks\Core\Reviews\ReviewResult;
use KcPrintworks\Core\Reviews\ReviewService;
use KcPrintworks\Core\Support\Json;

/** The rules for saving a customer review, against a gateway the test controls. */
final class ReviewServiceTest extends TestCase
{
    private const KEY = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';

    private FakeReviewGateway $gateway;
    private ReviewService $service;

    private function setUpService(): void
    {
        $this->gateway = new FakeReviewGateway();
        $this->service = new ReviewService($this->gateway);
    }

    /** @param array<string,mixed> $override */
    private function body(array $override = []): \stdClass
    {
        $base = ['productId' => 42, 'rating' => 5, 'name' => 'Robin Hood', 'email' => 'robin@example.com', 'review' => 'A really lovely case, it fits my cards perfectly.'];
        return Json::decode(Json::encode(array_filter($override + $base + ['clientKey' => self::KEY], static fn ($v): bool => $v !== null)));
    }

    public function testAGoodReviewIsSavedAsPendingWithTheNormalizedValues(): void
    {
        $this->setUpService();
        $result = $this->service->submit($this->body(['name' => '  Robin   Hood ', 'email' => 'Robin@Example.COM']));
        $this->assertSame(ReviewResult::RECEIVED, $result->status);
        $this->assertSame(200, $result->httpStatus());
        $this->assertSame([[42, 5, 'Robin Hood', 'robin@example.com', 'A really lovely case, it fits my cards perfectly.']], $this->gateway->inserted);
    }

    public function testNothingCanClaimApprovalOrVerification(): void
    {
        $this->setUpService();
        foreach (['verified' => true, 'approved' => 1, 'status' => 'approve', 'comment_approved' => 1, 'meta' => ['verified' => 1], 'ip' => '1.2.3.4', 'userId' => 1] as $field => $value) {
            $result = $this->service->submit($this->body([$field => $value]));
            $this->assertSame(ReviewResult::INVALID, $result->status, $field);
            $this->assertSame([['field' => $field, 'code' => 'unknown_field']], array_map(static fn (array $p): array => ['field' => $p['field'], 'code' => $p['code']], $result->problems), $field);
        }
        $this->assertSame([], $this->gateway->inserted);
    }

    public function testAnInvalidReviewListsEveryProblemAndSavesNothing(): void
    {
        $this->setUpService();
        $result = $this->service->submit(Json::decode('{"productId":0,"rating":9,"name":"","email":"x","review":"short"}'));
        $this->assertSame(ReviewResult::INVALID, $result->status);
        $this->assertSame(400, $result->httpStatus());
        $this->assertSame(['productId', 'rating', 'name', 'email', 'review'], array_map(static fn (array $p): string => $p['field'], $result->problems));
        $this->assertSame([], $this->gateway->inserted);
        $this->assertSame(0, $this->gateway->lookups, 'WooCommerce is not even asked');
    }

    public function testAnythingButAnObjectIsRefused(): void
    {
        $this->setUpService();
        foreach ([null, 'text', 5, [], Json::decode('[{"productId":1}]')] as $body) {
            $this->assertSame(ReviewResult::INVALID, $this->service->submit($body)->status);
        }
    }

    public function testReviewsSwitchedOffInWooCommerceAreClosed(): void
    {
        $this->setUpService();
        $this->gateway->enabled = false;
        $result = $this->service->submit($this->body());
        $this->assertSame(ReviewResult::CLOSED, $result->status);
        $this->assertSame(403, $result->httpStatus());
        $this->assertSame([], $this->gateway->inserted);
    }

    public function testAnUnknownProductAndAProductWithReviewsOffAreRefusedDifferently(): void
    {
        $this->setUpService();
        $this->gateway->state = ReviewGateway::PRODUCT_UNKNOWN;
        $unknown = $this->service->submit($this->body());
        $this->assertSame(ReviewResult::NOT_FOUND, $unknown->status);
        $this->assertSame(404, $unknown->httpStatus());
        $this->gateway->state = ReviewGateway::PRODUCT_CLOSED;
        $closed = $this->service->submit($this->body(['email' => 'other@example.com']));
        $this->assertSame(ReviewResult::CLOSED, $closed->status);
        $this->assertSame([], $this->gateway->inserted);
    }

    public function testWhenTheShopRequiresVerifiedOwnersOnlyThoseWooCommerceRecognizesCanReview(): void
    {
        $this->setUpService();
        $this->gateway->verifiedOnly = true;
        $stranger = $this->service->submit($this->body());
        $this->assertSame(ReviewResult::VERIFICATION, $stranger->status);
        $this->assertSame(403, $stranger->httpStatus());
        $this->assertSame([], $this->gateway->inserted);

        $this->gateway->owners = ['robin@example.com'];
        $this->assertSame(ReviewResult::RECEIVED, $this->service->submit($this->body(['email' => 'Robin@example.com']))->status);
        $this->assertCount(1, $this->gateway->inserted);
    }

    public function testWithoutThatSettingAnyoneMayReviewAndVerifiedIsNotDecidedHere(): void
    {
        $this->setUpService();
        $this->gateway->verifiedOnly = false;
        $this->assertSame(ReviewResult::RECEIVED, $this->service->submit($this->body())->status);
        // The service has no way to record "verified": the gateway interface does not even have a parameter for it.
        $this->assertSame(5, count($this->gateway->inserted[0]));
    }

    public function testASecondReviewByTheSameEmailIsKeptOutAndLooksExactlyLikeAFirst(): void
    {
        $this->setUpService();
        $first = $this->service->submit($this->body());
        $this->gateway->reviewers = ['robin@example.com'];
        $second = $this->service->submit($this->body(['review' => 'Trying to post another one for the same product.']));
        $this->assertSame($first->toArray(), $second->toArray());
        $this->assertCount(1, $this->gateway->inserted);

        // And when WordPress itself spots an identical comment, the answer is the same again.
        $this->gateway->reviewers = [];
        $this->gateway->insertResult = ReviewGateway::DUPLICATE;
        $third = $this->service->submit($this->body(['email' => 'new@example.com']));
        $this->assertSame($first->toArray(), $third->toArray());
    }

    public function testAFailedSaveIsAServerError(): void
    {
        $this->setUpService();
        $this->gateway->insertResult = 0;
        $result = $this->service->submit($this->body());
        $this->assertSame(ReviewResult::ERROR, $result->status);
        $this->assertSame(500, $result->httpStatus());
    }

    public function testTooManyAttemptsFromOneClientAreLimited(): void
    {
        $this->setUpService();
        for ($i = 1; $i <= ReviewService::CLIENT_LIMIT; $i++) {
            $this->assertSame(ReviewResult::RECEIVED, $this->service->submit($this->body(['email' => "person$i@example.com"]))->status, "attempt $i");
        }
        $limited = $this->service->submit($this->body(['email' => 'person99@example.com']));
        $this->assertSame(ReviewResult::RATE_LIMITED, $limited->status);
        $this->assertSame(429, $limited->httpStatus());
        $this->assertCount(ReviewService::CLIENT_LIMIT, $this->gateway->inserted);
        // Another client is not affected.
        $other = str_repeat('f', 64);
        $this->assertSame(ReviewResult::RECEIVED, $this->service->submit($this->body(['email' => 'person100@example.com', 'clientKey' => $other]))->status);
    }

    public function testTooManyAttemptsForOneEmailAreLimitedEvenFromDifferentClients(): void
    {
        $this->setUpService();
        for ($i = 1; $i <= ReviewService::EMAIL_LIMIT; $i++) {
            $this->service->submit($this->body(['clientKey' => str_repeat((string) $i, 64)]));
        }
        $limited = $this->service->submit($this->body(['clientKey' => str_repeat('9', 64)]));
        $this->assertSame(ReviewResult::RATE_LIMITED, $limited->status);
    }

    public function testEveryAttemptCountsEvenARefusedOne(): void
    {
        $this->setUpService();
        $this->gateway->state = ReviewGateway::PRODUCT_UNKNOWN;
        for ($i = 0; $i < ReviewService::CLIENT_LIMIT; $i++) {
            $this->assertSame(ReviewResult::NOT_FOUND, $this->service->submit($this->body(['email' => "p$i@example.com"]))->status);
        }
        $this->assertSame(ReviewResult::RATE_LIMITED, $this->service->submit($this->body(['email' => 'p99@example.com']))->status);
    }

    public function testAMalformedClientKeyIsIgnoredNotTrusted(): void
    {
        $this->setUpService();
        $result = $this->service->submit($this->body(['clientKey' => 'not-a-hash']));
        $this->assertSame(ReviewResult::RECEIVED, $result->status);
        $this->assertFalse(isset($this->gateway->counts['c:not-a-hash']));
        $keys = array_keys($this->gateway->counts);
        $this->assertTrue(count(array_filter($keys, static fn (string $k): bool => str_starts_with($k, 'c:')) ) === 0, 'no client bucket without a valid key');
    }

    public function testNoPrivateDetailIsKeptInTheCounters(): void
    {
        $this->setUpService();
        $this->service->submit($this->body());
        foreach (array_keys($this->gateway->counts) as $key) {
            $this->assertStringNotContains('robin', $key, 'the email address is hashed in counter keys');
            $this->assertStringNotContains('example.com', $key);
        }
    }
}
