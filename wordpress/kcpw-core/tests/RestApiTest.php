<?php
declare(strict_types=1);

namespace KcPrintworks\Core\Tests;

use KcPrintworks\Core\Auth\MemoryNonceStore;
use KcPrintworks\Core\Auth\RequestSigner;
use KcPrintworks\Core\Auth\RequestVerifier;
use KcPrintworks\Core\Handoff\MemoryHandoffStore;
use KcPrintworks\Core\Reviews\ReviewService;
use KcPrintworks\Core\Wp\RestApi;

final class RestApiTest extends TestCase
{
    private MemoryHandoffStore $store;
    private RestApi $api;
    private int $nonce = 0;

    private function setUpApi(string $secret = GlueFixtures::SECRET): void
    {
        \WpStub::reset();
        $this->store = new MemoryHandoffStore();
        $this->api = new RestApi(GlueFixtures::service(null, $this->store), new RequestVerifier($secret, new MemoryNonceStore()), '0.1.0');
        $this->api->routes();
    }

    private function request(string $method, string $route, string $body, ?string $secret = GlueFixtures::SECRET, ?int $time = null): \WP_REST_Request
    {
        $ts = (string) ($time ?? time());
        $nonce = str_pad('n' . ++$this->nonce, 20, '-');
        $headers = $secret === null ? [] : [
            'X-Kcpw-Timestamp' => $ts,
            'X-Kcpw-Nonce' => $nonce,
            'X-Kcpw-Signature' => RequestSigner::sign($secret, $ts, $nonce, $method, $route, $body),
        ];
        return new \WP_REST_Request($method, $route, $body, $headers);
    }

    public function testRegistersThreeRoutesAndEveryOneRequiresAPermissionCallback(): void
    {
        $this->setUpApi();
        $this->assertSame(['kcpw/v1/cart/quote', 'kcpw/v1/cart/handoff', 'kcpw/v1/status'], array_keys(\WpStub::$routes));
        foreach (\WpStub::$routes as $route => $args) {
            $this->assertTrue(is_callable($args['permission_callback']), "$route has a permission callback");
            $this->assertTrue($args['permission_callback'] !== '__return_true', $route);
        }
        $this->assertSame('POST', \WpStub::$routes['kcpw/v1/cart/handoff']['methods']);
        $this->assertSame('GET', \WpStub::$routes['kcpw/v1/status']['methods']);
    }

    public function testASignedRequestIsAuthorizedAndEverythingElseIsNot(): void
    {
        $this->setUpApi();
        $body = '{"lines":[{"productId":10,"quantity":1}]}';
        $this->assertTrue($this->api->authorize($this->request('POST', '/kcpw/v1/cart/handoff', $body)) === true);

        $unsigned = $this->api->authorize($this->request('POST', '/kcpw/v1/cart/handoff', $body, null));
        $this->assertTrue($unsigned instanceof \WP_Error);
        $this->assertSame(401, $unsigned->data['status']);

        $wrongSecret = $this->api->authorize($this->request('POST', '/kcpw/v1/cart/handoff', $body, 'x-wrong-secret-of-enough-length-to-pass'));
        $this->assertSame(401, $wrongSecret->data['status']);

        $stale = $this->api->authorize($this->request('POST', '/kcpw/v1/cart/handoff', $body, GlueFixtures::SECRET, time() - 1000));
        $this->assertSame(401, $stale->data['status']);

        $replay = $this->request('POST', '/kcpw/v1/cart/handoff', $body);
        $this->assertTrue($this->api->authorize($replay) === true);
        $this->assertSame(401, $this->api->authorize($replay)->data['status'], 'the same signed request twice is a replay');
    }

    public function testWithoutASecretTheEndpointsSayTheyAreNotSetUp(): void
    {
        $this->setUpApi('');
        $result = $this->api->authorize($this->request('POST', '/kcpw/v1/cart/handoff', '{}'));
        $this->assertTrue($result instanceof \WP_Error);
        $this->assertSame(503, $result->data['status']);
        $this->assertSame('kcpw_not_configured', $result->code);
    }

    public function testHandoffReturnsTheCheckoutUrlAndStoresOnlyIntents(): void
    {
        $this->setUpApi();
        $body = '{"lines":[{"productId":11,"quantity":2,"options":{"name":"Robin"}}],"expectedSubtotal":1798}';
        $response = $this->api->cart($this->request('POST', '/kcpw/v1/cart/handoff', $body), true);
        $this->assertSame(200, $response->status);
        $this->assertSame('no-store', $response->headers['Cache-Control']);
        $this->assertTrue($response->data['ok']);
        $this->assertSame('https://shop.example.com/?kcpw_handoff=' . GlueFixtures::token(1), $response->data['redirectUrl']);
        $this->assertSame(1798, $response->data['subtotal']);
        $this->assertSame('Robin', $response->data['lines'][0]['optionSummary'][0]['value']);
        $this->assertCount(1, $this->store->rows);
    }

    public function testQuoteDoesNotStoreAndReportsPriceChangesAndProblems(): void
    {
        $this->setUpApi();
        $quote = $this->api->cart($this->request('POST', '/kcpw/v1/cart/quote', '{"lines":[{"productId":10,"quantity":1}]}'), false);
        $this->assertSame(200, $quote->status);
        $this->assertTrue(!isset($quote->data['redirectUrl']));
        $this->assertCount(0, $this->store->rows);

        $changed = $this->api->cart($this->request('POST', '/kcpw/v1/cart/handoff', '{"lines":[{"productId":10,"quantity":1}],"expectedSubtotal":1}'), true);
        $this->assertSame(409, $changed->status);
        $this->assertSame(1324, $changed->data['subtotal']);

        $bad = $this->api->cart($this->request('POST', '/kcpw/v1/cart/handoff', '{"lines":[{"productId":13,"quantity":1}]}'), true);
        $this->assertSame(422, $bad->status);
        $this->assertSame('out_of_stock', $bad->data['lines'][0]['issues'][0]['code']);
        $this->assertCount(0, $this->store->rows);
    }

    public function testMalformedAndPriceBearingRequestsAreRefusedWith400(): void
    {
        $this->setUpApi();
        foreach (['not json', '{"lines":[{"productId":10,"quantity":1,"price":1}]}', '{"lines":[]}', '{"lines":[{"productId":10,"quantity":1}],"discount":50}'] as $body) {
            $response = $this->api->cart($this->request('POST', '/kcpw/v1/cart/handoff', $body), true);
            $this->assertSame(400, $response->status, $body);
            $this->assertSame('invalid_request', $response->data['status']);
            $this->assertTrue(count($response->data['problems']) > 0);
        }
        $this->assertCount(0, $this->store->rows);
    }

    public function testStatusReportsSetupWithoutSecrets(): void
    {
        $this->setUpApi();
        $response = $this->api->status($this->request('GET', '/kcpw/v1/status', ''));
        $this->assertSame(200, $response->status);
        $json = (string) json_encode($response->data);
        $this->assertStringNotContains(GlueFixtures::SECRET, $json);
        $this->assertSame('0.1.0', $response->data['plugin']);
        $this->assertSame('9.9.9', $response->data['woocommerce']);
        $this->assertTrue($response->data['storefrontUrlConfigured']);
        $this->assertFalse($response->data['stripeActive']);
    }

    private function setUpReviewApi(?FakeReviewGateway $gateway = null): FakeReviewGateway
    {
        \WpStub::reset();
        $gateway ??= new FakeReviewGateway();
        $this->api = new RestApi(
            GlueFixtures::service(null, new MemoryHandoffStore()),
            new RequestVerifier(GlueFixtures::SECRET, new MemoryNonceStore()),
            '0.2.0',
            new ReviewService($gateway),
        );
        $this->api->routes();
        return $gateway;
    }

    public function testTheReviewRouteExistsOnlyWhenReviewsAreWiredAndIsSignedLikeTheOthers(): void
    {
        $this->setUpApi();
        $this->assertFalse(isset(\WpStub::$routes['kcpw/v1/reviews']));
        $this->setUpReviewApi();
        $route = \WpStub::$routes['kcpw/v1/reviews'];
        $this->assertSame('POST', $route['methods']);
        $this->assertTrue(is_callable($route['permission_callback']) && $route['permission_callback'] !== '__return_true');
        $body = '{"productId":10,"rating":5}';
        $unsigned = $this->api->authorize($this->request('POST', '/kcpw/v1/reviews', $body, null));
        $this->assertSame(401, $unsigned->data['status']);
        $this->assertTrue($this->api->authorize($this->request('POST', '/kcpw/v1/reviews', $body)) === true);
    }

    public function testAGoodReviewIsReceivedAndSavedPendingNothingElseIsReturned(): void
    {
        $gateway = $this->setUpReviewApi();
        $body = '{"productId":10,"rating":4,"name":"Robin Hood","email":"robin@example.com","review":"A really lovely case, thank you.","clientKey":"' . str_repeat('a', 64) . '"}';
        $response = $this->api->review($this->request('POST', '/kcpw/v1/reviews', $body));
        $this->assertSame(200, $response->status);
        $this->assertSame('no-store', $response->headers['Cache-Control']);
        $this->assertSame(['ok' => true, 'status' => 'received'], $response->data);
        $this->assertCount(1, $gateway->inserted);
        $this->assertStringNotContains('robin@example.com', (string) json_encode($response->data), 'no customer detail in the answer');
    }

    public function testBadJsonAndBadReviewsAreRefusedWithTheProblemsListed(): void
    {
        $gateway = $this->setUpReviewApi();
        $notJson = $this->api->review($this->request('POST', '/kcpw/v1/reviews', 'not json'));
        $this->assertSame(400, $notJson->status);
        $this->assertSame('invalid_request', $notJson->data['status']);
        $claims = $this->api->review($this->request('POST', '/kcpw/v1/reviews', '{"productId":10,"rating":5,"name":"Robin Hood","email":"robin@example.com","review":"A really lovely case.","verified":true}'));
        $this->assertSame(400, $claims->status);
        $this->assertSame('unknown_field', $claims->data['problems'][0]['code']);
        $this->assertCount(0, $gateway->inserted);
    }

    public function testRefusalsMapToTheirHttpStatuses(): void
    {
        $gateway = $this->setUpReviewApi();
        $body = '{"productId":10,"rating":5,"name":"Robin Hood","email":"robin@example.com","review":"A really lovely case."}';
        $gateway->state = 'unknown';
        $this->assertSame(404, $this->api->review($this->request('POST', '/kcpw/v1/reviews', $body))->status);
        $gateway->state = 'open';
        $gateway->verifiedOnly = true;
        $response = $this->api->review($this->request('POST', '/kcpw/v1/reviews', $body));
        $this->assertSame(403, $response->status);
        $this->assertSame('verification_required', $response->data['status']);
        $gateway->verifiedOnly = false;
        $gateway->insertResult = 0;
        $this->assertSame(500, $this->api->review($this->request('POST', '/kcpw/v1/reviews', $body))->status);
    }
}
