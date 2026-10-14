<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Tests;

use KcPrintworks\Etsy\Api\AccessDenied;
use KcPrintworks\Etsy\Api\ApiError;
use KcPrintworks\Etsy\Api\ApiKeyHeader;
use KcPrintworks\Etsy\Api\EtsyClient;
use KcPrintworks\Etsy\Api\NotFound;
use KcPrintworks\Etsy\Http\Request;
use KcPrintworks\Etsy\Http\Response;
use KcPrintworks\Etsy\Oauth\NeedsReauth;
use KcPrintworks\Etsy\Oauth\NullLock;
use KcPrintworks\Etsy\Oauth\OAuthClient;
use KcPrintworks\Etsy\Oauth\OAuthConfig;
use KcPrintworks\Etsy\Oauth\Scopes;
use KcPrintworks\Etsy\Oauth\TokenSet;
use KcPrintworks\Etsy\Oauth\TokenSource;

final class EtsyClientTest extends TestCase
{
    /** @var list<int> */
    private array $slept = [];

    /** @return array{0:EtsyClient,1:FakeTransport,2:MemoryTokenStore,3:FakeTransport} */
    private function build(?callable $router = null, int $expiresAt = 4_000_000_000): array
    {
        $api = new FakeTransport($router);
        $store = new MemoryTokenStore(new TokenSet('7.access-one', 'refresh-one', $expiresAt, ['shops_r'], 1));
        $oauthTransport = new FakeTransport();
        $config = new OAuthConfig('test-keystring', 'https://shop.example.com/cb', Scopes::PRODUCT_IMPORT);
        $source = new TokenSource($store, new OAuthClient($config, $oauthTransport, fn () => 1_000), new NullLock(), fn () => 1_000);
        $client = new EtsyClient($api, $source, new ApiKeyHeader('test-keystring'), EtsyClient::API_BASE, function (int $s): void {
            $this->slept[] = $s;
        });
        return [$client, $api, $store, $oauthTransport];
    }

    public function testRequestsAreGetsWithKeyAndBearerTokenAndNothingElse(): void
    {
        [$client, $api] = $this->build(fn () => FakeTransport::json(['user_id' => 7, 'shop_id' => 99]));
        $me = $client->getMe();
        $this->assertSame(99, $me['shop_id']);
        $request = $api->requests[0];
        $this->assertSame('GET', $request->method);
        $this->assertSame('https://api.etsy.com/v3/application/users/me', $request->url);
        $this->assertSame('test-keystring', $request->headers['x-api-key']);
        $this->assertSame('Bearer 7.access-one', $request->headers['Authorization']);
        $this->assertNull($request->body);
    }

    public function testSharedSecretFormatIsOneSetting(): void
    {
        $this->assertSame('key:secret', (new ApiKeyHeader('key', 'secret', true))->value());
        $this->assertSame('key', (new ApiKeyHeader('key', 'secret', false))->value());
        $this->assertThrows(\InvalidArgumentException::class, fn () => new ApiKeyHeader('key', '', true));
    }

    public function testListingsArePagedUntilCountIsReached(): void
    {
        [$client, $api] = $this->build(function (Request $r): Response {
            parse_str((string) parse_url($r->url, PHP_URL_QUERY), $q);
            $offset = (int) $q['offset'];
            $results = [];
            for ($i = $offset; $i < min($offset + 100, 230); $i++) {
                $results[] = ['listing_id' => 1000 + $i];
            }
            return FakeTransport::json(['count' => 230, 'results' => $results]);
        });
        $ids = [];
        foreach ($client->iterateListings(55, ['active']) as $listing) {
            $ids[] = $listing['listing_id'];
        }
        $this->assertCount(230, $ids);
        $this->assertSame(1229, end($ids));
        $this->assertCount(3, $api->requests);
        $this->assertStringContains('/shops/55/listings?state=active&limit=100&offset=200', $api->requests[2]->url);
    }

    public function testRateLimitsBackOffAndHonorRetryAfter(): void
    {
        [$client, $api] = $this->build();
        $api->queue(
            FakeTransport::json(['error' => 'slow down'], 429, ['Retry-After' => '3']),
            FakeTransport::json(['error' => 'oops'], 503),
            FakeTransport::json(['listing_id' => 5], 200, ['x-limit-per-day' => '10000', 'x-remaining-today' => '1500']),
        );
        $this->assertSame(5, $client->getListing(5)['listing_id']);
        $this->assertSame([3, 2], $this->slept);
        $this->assertSame(1500, $client->lastQuota()->remainingToday);
        $this->assertTrue($client->lastQuota()->backgroundBudgetExhausted(), '15% left is below the 20% reserve');
    }

    public function testGivesUpAfterTheRetryBudgetWithoutLeakingTokens(): void
    {
        [$client, $api] = $this->build(fn () => FakeTransport::json(['error' => 'down'], 500));
        $e = $this->assertThrows(ApiError::class, fn () => $client->getListing(5), 'HTTP 500');
        $this->assertStringNotContains('access-one', $e->getMessage());
        $this->assertCount(4, $api->requests);
    }

    public function testClientErrorsAreNotRetriedAndMapToClearTypes(): void
    {
        [$client, $api] = $this->build();
        $api->queue(FakeTransport::json([], 403), FakeTransport::json([], 404), FakeTransport::json(['error' => 'bad'], 400));
        $this->assertThrows(AccessDenied::class, fn () => $client->getShop(1));
        $this->assertThrows(NotFound::class, fn () => $client->getListing(2));
        $this->assertThrows(ApiError::class, fn () => $client->getInventory(3), 'HTTP 400');
        $this->assertSame([], $this->slept);
    }

    public function testA401TriggersExactlyOneRefreshAndRetry(): void
    {
        [$client, $api, $store, $oauthTransport] = $this->build();
        $oauthTransport->queue(FakeTransport::json(['access_token' => '7.access-two', 'refresh_token' => 'refresh-two', 'expires_in' => 3600]));
        $api->queue(FakeTransport::json([], 401), FakeTransport::json(['shop_id' => 1]));
        $this->assertSame(1, $client->getMe()['shop_id']);
        $this->assertSame('Bearer 7.access-two', $api->requests[1]->headers['Authorization']);
        $this->assertSame('refresh-two', $store->tokens->refreshToken);
    }

    public function testAPersistent401MeansReauthAndDoesNotLoop(): void
    {
        [$client, $api, , $oauthTransport] = $this->build(fn () => FakeTransport::json([], 401));
        $oauthTransport->queue(FakeTransport::json(['access_token' => '7.access-two', 'refresh_token' => 'refresh-two', 'expires_in' => 3600]));
        $this->assertThrows(NeedsReauth::class, fn () => $client->getMe());
        $this->assertCount(2, $api->requests);
    }

    public function testNonJsonSuccessIsAnApiError(): void
    {
        [$client] = $this->build(fn () => new Response(200, [], '<html>maintenance</html>'));
        $this->assertThrows(ApiError::class, fn () => $client->getMe(), 'not JSON');
    }
}
