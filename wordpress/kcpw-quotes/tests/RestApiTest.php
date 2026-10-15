<?php
declare(strict_types=1);

namespace KcPrintworks\Quotes\Tests;

use KcPrintworks\Quotes\Auth\RequestSigner;
use KcPrintworks\Quotes\Domain\Status;
use KcPrintworks\Quotes\Support\Json;

final class RestApiTest extends TestCase
{
    private function body(array $request = [], array $files = []): string
    {
        $payload = ['request' => Fixtures::request($request), 'clientKey' => bin2hex(random_bytes(32))];
        if ($files !== []) {
            $payload['files'] = $files;
        }
        return json_encode($payload, JSON_THROW_ON_ERROR);
    }

    public function testFourRoutesEachWithAPermissionCallback(): void
    {
        $g = GlueFixtures::boot();
        \WpStub::$actions['rest_api_init'][0]();
        $this->assertSame(
            ['kcpw-quotes/v1/requests', 'kcpw-quotes/v1/quote/view', 'kcpw-quotes/v1/quote/approve', 'kcpw-quotes/v1/status'],
            array_keys(\WpStub::$routes),
        );
        foreach (\WpStub::$routes as $route => $args) {
            $this->assertTrue(is_callable($args['permission_callback']), "$route has a permission callback");
            $this->assertTrue($args['permission_callback'] !== '__return_true', $route);
        }
        $this->assertSame('GET', \WpStub::$routes['kcpw-quotes/v1/status']['methods']);
        $this->assertSame('POST', \WpStub::$routes['kcpw-quotes/v1/requests']['methods']);
        $g->cleanup();
    }

    public function testOnlyASignedFreshRequestIsAuthorized(): void
    {
        $g = GlueFixtures::boot();
        \WpStub::$actions['rest_api_init'][0]();
        $route = '/kcpw-quotes/v1/requests';
        $body = $this->body();
        $permission = \WpStub::$routes['kcpw-quotes/v1/requests']['permission_callback'];

        $this->assertTrue($permission($g->request('POST', $route, $body)) === true);
        $wrong = $permission($g->request('POST', $route, $body, 'x-wrong-secret-of-enough-length-to-pass'));
        $this->assertTrue($wrong instanceof \WP_Error);
        $this->assertSame(401, $wrong->data['status']);
        $stale = $permission($g->request('POST', $route, $body, null, time() - 1000));
        $this->assertSame(401, $stale->data['status']);
        $unsigned = $permission(new \WP_REST_Request('POST', $route, $body, []));
        $this->assertSame(401, $unsigned->data['status']);
        $replay = $g->request('POST', $route, $body);
        $this->assertTrue($permission($replay) === true);
        $this->assertSame(401, $permission($replay)->data['status'], 'the same signed request twice is a replay');
        // A signature made for another route does not work here.
        $other = $g->request('POST', '/kcpw-quotes/v1/quote/view', $body);
        $forged = new \WP_REST_Request('POST', $route, $body, ['X-Kcpw-Timestamp' => (string) time(), 'X-Kcpw-Nonce' => 'abcdefghijklmnopqrstu', 'X-Kcpw-Signature' => RequestSigner::sign(\KCPW_HANDOFF_SECRET, (string) time(), 'abcdefghijklmnopqrstu', 'POST', '/kcpw-quotes/v1/quote/view', $body)]);
        $this->assertSame(401, $permission($forged)->data['status']);
        $g->cleanup();
    }

    public function testASignedRequestSavesAQuoteAndSendsTheEmails(): void
    {
        $g = GlueFixtures::boot();
        \WpStub::$actions['rest_api_init'][0]();
        $response = $g->call('POST', '/kcpw-quotes/v1/requests', $this->body([], [Fixtures::picture()]));
        $this->assertTrue($response instanceof \WP_REST_Response);
        $this->assertSame(200, $response->status);
        $this->assertSame(true, $response->data['ok']);
        $this->assertSame('received', $response->data['status']);
        $this->assertSame('no-store', $response->headers['Cache-Control']);
        $quote = $g->repo->findByRef($response->data['ref']);
        $this->assertSame(Status::NEW, $quote?->status());
        $this->assertCount(1, $g->repo->files($quote->id()));
        $this->assertSame(2, count(\WpStub::$mail));
        $this->assertSame('contact@kcprintworks.com', \WpStub::$mail[1]['to']);
        $this->assertContains('Reply-To: robin@example.com', \WpStub::$mail[1]['headers']);
        $this->assertContains('Content-Type: text/plain; charset=UTF-8', \WpStub::$mail[1]['headers']);
        $g->cleanup();
    }

    public function testBadBodiesGetSpecificStatusesAndStoreNothing(): void
    {
        $g = GlueFixtures::boot();
        \WpStub::$actions['rest_api_init'][0]();
        $this->assertSame(400, $g->call('POST', '/kcpw-quotes/v1/requests', 'not json')->status);
        $invalid = $g->call('POST', '/kcpw-quotes/v1/requests', $this->body(['email' => 'nope']));
        $this->assertSame(400, $invalid->status);
        $this->assertSame('invalid_request', $invalid->data['status']);
        $this->assertSame('email', $invalid->data['problems'][0]['field']);
        $priced = $g->call('POST', '/kcpw-quotes/v1/requests', $this->body(['price' => 1]));
        $this->assertSame('unknown_field', $priced->data['problems'][0]['code']);
        $bad = $g->call('POST', '/kcpw-quotes/v1/requests', $this->body([], [['name' => 'x.png', 'type' => 'image/png', 'data' => base64_encode('<?php echo 1;')]]));
        $this->assertSame(400, $bad->status);
        $this->assertSame('invalid_file', $bad->data['status']);
        $this->assertSame(0, array_sum($g->repo->counts()));
        $g->cleanup();
    }

    public function testViewAndApproveGoThroughTheRulesAndNeverTakeAPrice(): void
    {
        $g = GlueFixtures::boot();
        \WpStub::$actions['rest_api_init'][0]();
        $saved = $g->call('POST', '/kcpw-quotes/v1/requests', $this->body());
        $quote = $g->repo->findByRef($saved->data['ref']);
        $offer = ['title' => 'Custom case for Catan', 'details' => '', 'itemCents' => 4500, 'shipCents' => 850, 'expiresAt' => time() + 5 * 86400];
        $this->assertTrue($g->admin->sendQuote($quote->id(), $offer, 'admin:7')->ok);
        preg_match('/token=([A-Za-z0-9_-]{43})/', end(\WpStub::$mail)['message'], $m);
        $token = $m[1];

        $view = $g->call('POST', '/kcpw-quotes/v1/quote/view', json_encode(['ref' => $quote->ref(), 'token' => $token]));
        $this->assertSame(200, $view->status);
        $this->assertSame('open', $view->data['state']);
        $this->assertSame(5350, $view->data['totalCents']);

        $bad = $g->call('POST', '/kcpw-quotes/v1/quote/view', json_encode(['ref' => $quote->ref(), 'token' => str_repeat('A', 43)]));
        $this->assertSame(404, $bad->status);
        $this->assertSame(['ok' => false, 'status' => 'invalid_link'], $bad->data);
        $this->assertSame(404, $g->call('POST', '/kcpw-quotes/v1/quote/view', json_encode(['ref' => $quote->ref(), 'token' => $token, 'extra' => 1]))->status, 'strict body');
        $this->assertSame(404, $g->call('POST', '/kcpw-quotes/v1/quote/view', '[]')->status);

        $approval = Fixtures::approval(1);
        $withPrice = $g->call('POST', '/kcpw-quotes/v1/quote/approve', json_encode(['ref' => $quote->ref(), 'token' => $token, 'approval' => $approval + ['itemCents' => 1]]));
        $this->assertSame(400, $withPrice->status);
        $this->assertSame('invalid_request', $withPrice->data['status']);
        $this->assertSame(0, count(\WpStub::$orders), 'no order for a body that tried to set a price');

        $ok = $g->call('POST', '/kcpw-quotes/v1/quote/approve', json_encode(['ref' => $quote->ref(), 'token' => $token, 'approval' => $approval]));
        $this->assertSame(200, $ok->status);
        $this->assertSame('approved', $ok->data['status']);
        $this->assertStringContains('/checkout/order-pay/', $ok->data['payUrl']);
        $this->assertSame(1, count(\WpStub::$orders));
        $order = array_values(\WpStub::$orders)[0];
        $this->assertSame('5350', (string) round(((float) $order->total) * 100));

        $stale = $g->call('POST', '/kcpw-quotes/v1/quote/approve', json_encode(['ref' => $quote->ref(), 'token' => $token, 'approval' => Fixtures::approval(7)]));
        $this->assertSame(200, $stale->status, 'a second approval is the same answer, not an error and not a second order');
        $this->assertSame(1, count(\WpStub::$orders));
        $g->cleanup();
    }

    public function testStatusReportsReadinessWithoutSecretsOrCustomerData(): void
    {
        $g = GlueFixtures::boot();
        \WpStub::$actions['rest_api_init'][0]();
        $g->call('POST', '/kcpw-quotes/v1/requests', $this->body());
        $response = $g->call('GET', '/kcpw-quotes/v1/status');
        $this->assertSame(200, $response->status);
        $this->assertSame('0.1.0-test', $response->data['plugin']);
        $this->assertSame(true, $response->data['storefrontUrlConfigured']);
        $this->assertSame('https://storefront.example.com', $response->data['storefrontUrl']);
        $text = json_encode($response->data) ?: '';
        $this->assertStringNotContains(\KCPW_HANDOFF_SECRET, $text);
        $this->assertStringNotContains('robin@example.com', $text);
        $this->assertStringNotContains('KCQ-', $text);
        $g->cleanup();
    }
}
