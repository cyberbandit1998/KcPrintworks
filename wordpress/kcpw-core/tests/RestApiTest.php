<?php
declare(strict_types=1);

namespace KcPrintworks\Core\Tests;

use KcPrintworks\Core\Auth\MemoryNonceStore;
use KcPrintworks\Core\Auth\RequestSigner;
use KcPrintworks\Core\Auth\RequestVerifier;
use KcPrintworks\Core\Handoff\MemoryHandoffStore;
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
}
