<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Tests;

use KcPrintworks\Etsy\Http\ReadOnlyTransport;
use KcPrintworks\Etsy\Http\Request;
use KcPrintworks\Etsy\Http\WriteBlocked;
use KcPrintworks\Etsy\Oauth\AuthorizationRequest;
use KcPrintworks\Etsy\Oauth\NeedsReauth;
use KcPrintworks\Etsy\Oauth\NullLock;
use KcPrintworks\Etsy\Oauth\OAuthClient;
use KcPrintworks\Etsy\Oauth\OAuthConfig;
use KcPrintworks\Etsy\Oauth\Pkce;
use KcPrintworks\Etsy\Oauth\Scopes;
use KcPrintworks\Etsy\Oauth\TokenSet;
use KcPrintworks\Etsy\Oauth\TokenSource;

final class OAuthTest extends TestCase
{
    private function config(): OAuthConfig
    {
        return new OAuthConfig('test-keystring', 'https://shop.example.com/wp-json/kcpw-etsy/v1/oauth/callback', Scopes::PRODUCT_IMPORT);
    }

    public function testPkceMatchesTheRfc7636Example(): void
    {
        $this->assertSame('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM', Pkce::challenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'));
    }

    public function testVerifierAndStateAreUrlSafeAndLongEnough(): void
    {
        $verifier = Pkce::verifier();
        $this->assertTrue(strlen($verifier) >= 43 && strlen($verifier) <= 128);
        $this->assertSame(1, preg_match('/^[A-Za-z0-9\-_]+$/', $verifier));
        $this->assertTrue(Pkce::state() !== Pkce::state());
        $this->assertThrows(\InvalidArgumentException::class, fn () => Pkce::verifier(8));
    }

    public function testAuthorizationUrlCarriesPkceStateAndOnlyReadScopes(): void
    {
        $request = AuthorizationRequest::begin($this->config());
        $parts = parse_url($request->url);
        $this->assertSame('www.etsy.com', $parts['host']);
        $this->assertSame('/oauth/connect', $parts['path']);
        parse_str($parts['query'], $q);
        $this->assertSame('code', $q['response_type']);
        $this->assertSame('test-keystring', $q['client_id']);
        $this->assertSame('shops_r listings_r', $q['scope']);
        $this->assertSame('S256', $q['code_challenge_method']);
        $this->assertSame(Pkce::challenge($request->codeVerifier), $q['code_challenge']);
        $this->assertSame($request->state, $q['state']);
        $this->assertStringNotContains($request->codeVerifier, $request->url, 'the verifier must never be in the URL');
    }

    public function testWriteAndDeleteScopesAreRefused(): void
    {
        foreach (['listings_w', 'listings_d', 'transactions_w', 'email_r', 'profile_r'] as $scope) {
            $this->assertThrows(\InvalidArgumentException::class, fn () => new OAuthConfig('k', 'https://x.example/cb', [$scope]), $scope);
        }
        $this->assertSame(['shops_r', 'listings_r', 'transactions_r'], Scopes::assertReadOnly(['shops_r', 'listings_r', 'transactions_r', 'shops_r']));
    }

    public function testRedirectUriMustBeHttpsAndKeyMustExist(): void
    {
        $this->assertThrows(\InvalidArgumentException::class, fn () => new OAuthConfig('k', 'http://x.example/cb', ['shops_r']), 'https');
        $this->assertThrows(\InvalidArgumentException::class, fn () => new OAuthConfig('', 'https://x.example/cb', ['shops_r']), 'keystring');
    }

    public function testCodeExchangePostsTheVerifierAndBuildsATokenSet(): void
    {
        $transport = (new FakeTransport())->queue(FakeTransport::json(['access_token' => '12345.abcdef', 'refresh_token' => 'r-1', 'expires_in' => 3600, 'token_type' => 'Bearer']));
        $client = new OAuthClient($this->config(), $transport, fn () => 1_000_000);
        $tokens = $client->exchangeCode('the-code', 'the-verifier');

        $request = $transport->requests[0];
        $this->assertSame('POST', $request->method);
        $this->assertSame(OAuthConfig::TOKEN_URL, $request->url);
        parse_str((string) $request->body, $form);
        $this->assertSame('authorization_code', $form['grant_type']);
        $this->assertSame('the-verifier', $form['code_verifier']);
        $this->assertSame('the-code', $form['code']);
        $this->assertSame(1_003_600, $tokens->expiresAt);
        $this->assertSame(12345, $tokens->userId());
        $this->assertSame(['shops_r', 'listings_r'], $tokens->scopes);
    }

    public function testInvalidGrantMeansReauthAndOtherFailuresDoNotLeakBodies(): void
    {
        $client = new OAuthClient($this->config(), (new FakeTransport())->queue(FakeTransport::json(['error' => 'invalid_grant'], 400)));
        $this->assertThrows(NeedsReauth::class, fn () => $client->exchangeCode('c', 'v'));

        $client = new OAuthClient($this->config(), (new FakeTransport())->queue(FakeTransport::json(['error' => 'server_error', 'secret' => 'SHOULD-NOT-APPEAR'], 500)));
        $e = $this->assertThrows(\KcPrintworks\Etsy\Oauth\OAuthError::class, fn () => $client->exchangeCode('c', 'v'), 'HTTP 500');
        $this->assertStringNotContains('SHOULD-NOT-APPEAR', $e->getMessage());
    }

    public function testTokenSetNeverPrintsItsSecrets(): void
    {
        $tokens = new TokenSet('12345.super-secret-access', 'super-secret-refresh', 2000, ['shops_r'], 1000);
        $dumped = print_r($tokens, true) . var_export($tokens->__debugInfo(), true);
        $this->assertStringNotContains('super-secret', $dumped);
    }

    public function testRefreshIsPersistedBeforeTheNewAccessTokenIsUsed(): void
    {
        $store = new MemoryTokenStore(new TokenSet('1.old', 'refresh-old', 1_000_100, ['shops_r'], 900_000));
        $transport = (new FakeTransport())->queue(FakeTransport::json(['access_token' => '1.new', 'refresh_token' => 'refresh-new', 'expires_in' => 3600]));
        $source = new TokenSource($store, new OAuthClient($this->config(), $transport, fn () => 1_000_000), new NullLock(), fn () => 1_000_000);

        $this->assertSame('1.new', $source->accessToken()); // expires in 100 s, inside the 300 s margin
        $this->assertSame('refresh-new', $store->tokens->refreshToken);
        $this->assertSame(1, $store->saves);
    }

    public function testFreshTokensAreNotRefreshedAndMissingOnesNeedReauth(): void
    {
        $store = new MemoryTokenStore(new TokenSet('1.ok', 'r', 1_010_000, ['shops_r'], 1_000_000));
        $transport = new FakeTransport();
        $source = new TokenSource($store, new OAuthClient($this->config(), $transport), new NullLock(), fn () => 1_000_000);
        $this->assertSame('1.ok', $source->accessToken());
        $this->assertCount(0, $transport->requests);

        $empty = new TokenSource(new MemoryTokenStore(), new OAuthClient($this->config(), $transport));
        $this->assertThrows(NeedsReauth::class, fn () => $empty->accessToken());
    }

    public function testReadOnlyTransportAllowsReadsAndTheTokenCallOnly(): void
    {
        $inner = new FakeTransport(fn () => FakeTransport::json([]));
        $guard = new ReadOnlyTransport($inner, 'https://api.etsy.com/v3/application', OAuthConfig::TOKEN_URL);

        $guard->send(new Request('GET', 'https://api.etsy.com/v3/application/users/me'));
        $guard->send(new Request('POST', OAuthConfig::TOKEN_URL, [], 'grant_type=refresh_token'));
        $this->assertCount(2, $inner->requests);

        $blocked = [
            new Request('PUT', 'https://api.etsy.com/v3/application/listings/1/inventory', [], '{}'),
            new Request('POST', 'https://api.etsy.com/v3/application/shops/1/listings', [], '{}'),
            new Request('DELETE', 'https://api.etsy.com/v3/application/listings/1'),
            new Request('PATCH', 'https://api.etsy.com/v3/application/listings/1'),
            new Request('POST', 'https://api.etsy.com/v3/application/users/me'),
            new Request('GET', 'https://evil.example/v3/application/users/me'),
            new Request('GET', 'http://api.etsy.com/v3/application/users/me'),
            new Request('GET', 'https://user:pw@api.etsy.com/v3/application/users/me'),
            new Request('GET', 'https://api.etsy.com/v3/application.evil/x'),
        ];
        foreach ($blocked as $request) {
            $this->assertThrows(WriteBlocked::class, fn () => $guard->send($request));
        }
        $this->assertCount(2, $inner->requests, 'blocked requests never reach the network');
    }
}
