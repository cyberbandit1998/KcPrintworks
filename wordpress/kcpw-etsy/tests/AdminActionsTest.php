<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Tests;

use KcPrintworks\Etsy\Admin\Actions;
use KcPrintworks\Etsy\Admin\Denied;
use KcPrintworks\Etsy\Admin\EmptyMappingStore;
use KcPrintworks\Etsy\Admin\MemoryPendingAuthStore;
use KcPrintworks\Etsy\Admin\MemorySettingsStore;
use KcPrintworks\Etsy\Admin\PreviewService;
use KcPrintworks\Etsy\Admin\Redirect;
use KcPrintworks\Etsy\Admin\Scheduler;
use KcPrintworks\Etsy\Api\ApiKeyHeader;
use KcPrintworks\Etsy\Api\EtsyClient;
use KcPrintworks\Etsy\Http\Request;
use KcPrintworks\Etsy\Http\Response;
use KcPrintworks\Etsy\Match\ArrayDecisionStore;
use KcPrintworks\Etsy\Match\Decision;
use KcPrintworks\Etsy\Oauth\NullLock;
use KcPrintworks\Etsy\Oauth\OAuthClient;
use KcPrintworks\Etsy\Oauth\OAuthConfig;
use KcPrintworks\Etsy\Oauth\Scopes;
use KcPrintworks\Etsy\Oauth\TokenSet;
use KcPrintworks\Etsy\Oauth\TokenSource;
use KcPrintworks\Etsy\Snapshot\Collector;
use KcPrintworks\Etsy\Snapshot\MemoryRunStateStore;
use KcPrintworks\Etsy\Snapshot\MemorySnapshotStore;
use KcPrintworks\Etsy\Woo\WooReader;

final class RecordingScheduler implements Scheduler
{
    public int $scheduled = 0;
    public bool $cancelled = false;

    public function scheduleBatch(int $delaySeconds = 2): void
    {
        $this->scheduled++;
    }

    public function cancel(): void
    {
        $this->cancelled = true;
    }
}

final class FixedWooReader implements WooReader
{
    public int $reads = 0;

    /** @param list<\KcPrintworks\Etsy\Woo\WooProduct> $products */
    public function __construct(private array $products)
    {
    }

    public function products(): array
    {
        $this->reads++;
        return $this->products;
    }
}

final class AdminActionsTest extends TestCase
{
    private FakeGateway $wp;
    private MemoryTokenStore $tokens;
    private MemoryPendingAuthStore $pending;
    private MemorySettingsStore $settings;
    private ArrayDecisionStore $decisions;
    private MemorySnapshotStore $snapshots;
    private RecordingScheduler $scheduler;
    private FakeTransport $oauthTransport;
    private FakeTransport $apiTransport;
    private Actions $actions;

    public function __construct()
    {
        $this->build();
    }

    private function build(bool $configured = true): void
    {
        $this->wp = new FakeGateway();
        $this->tokens = new MemoryTokenStore();
        $this->pending = new MemoryPendingAuthStore();
        $this->settings = new MemorySettingsStore();
        $this->decisions = new ArrayDecisionStore();
        $this->snapshots = new MemorySnapshotStore();
        $this->scheduler = new RecordingScheduler();
        $this->oauthTransport = new FakeTransport();
        $this->apiTransport = new FakeTransport(function (Request $r): Response {
            $path = (string) parse_url($r->url, PHP_URL_PATH);
            return match (true) {
                str_ends_with($path, '/users/me') => FakeTransport::json(['user_id' => 7, 'shop_id' => 99]),
                preg_match('#/shops/99$#', $path) === 1 => FakeTransport::json(['shop_name' => 'KCPrintWorks']),
                preg_match('#/shops/99/listings$#', $path) === 1 => FakeTransport::json(['count' => 1, 'results' => [Fixtures::rawListing(555)]], 200, ['x-limit-per-day' => '10000', 'x-remaining-today' => '9000']),
                preg_match('#/listings/555/inventory$#', $path) === 1 => FakeTransport::json(Fixtures::rawInventory([[1, 'S', ['C' => 'x'], 100]])),
                preg_match('#/listings/555/images$#', $path) === 1 => FakeTransport::json(Fixtures::rawImages([77])),
                default => FakeTransport::json([], 404),
            };
        });
        $config = static function () use ($configured): OAuthConfig {
            if (!$configured) {
                throw new \InvalidArgumentException('not configured');
            }
            return new OAuthConfig('test-key', 'https://shop.example.com/wp-json/kcpw-etsy/v1/oauth/callback', Scopes::PRODUCT_IMPORT);
        };
        $oauthFor = fn (OAuthConfig $c): OAuthClient => new OAuthClient($c, $this->oauthTransport, fn () => 1_000);
        $client = fn (): EtsyClient => new EtsyClient($this->apiTransport, new TokenSource($this->tokens, $oauthFor($config()), new NullLock(), fn () => 1_000), new ApiKeyHeader('test-key'), EtsyClient::API_BASE, static function (int $s): void {
        });
        $states = new MemoryRunStateStore();
        $woo = new FixedWooReader([Fixtures::woo(10), Fixtures::woo(11, 'Other thing')]);
        $this->woo = $woo;
        $preview = new PreviewService($this->snapshots, $woo, $this->decisions, new EmptyMappingStore(), $this->settings);
        $this->actions = new Actions($this->wp, $config, $this->pending, $oauthFor, $this->tokens, $client, $this->settings, fn (): Collector => new Collector($client(), $this->snapshots, $states), $this->decisions, $this->snapshots, $woo, $this->scheduler, $preview);
    }

    private FixedWooReader $woo;

    private function redirectOf(callable $work): string
    {
        try {
            $work();
        } catch (Redirect $r) {
            return $r->url;
        }
        throw new AssertionFailed('Expected a redirect.');
    }

    private function denial(callable $work): Denied
    {
        $e = $this->assertThrows(Denied::class, $work);
        return $e;
    }

    public function testEveryStateChangingActionChecksMethodCapabilityAndNonceInThatOrder(): void
    {
        $actions = [
            'connect' => ['kcpw_etsy_connect', 'manage_options'],
            'disconnect' => ['kcpw_etsy_disconnect', 'manage_options'],
            'testConnection' => ['kcpw_etsy_test', 'manage_woocommerce'],
            'refreshSnapshot' => ['kcpw_etsy_refresh', 'manage_woocommerce'],
            'saveDecisions' => ['kcpw_etsy_decisions', 'manage_woocommerce'],
        ];
        foreach ($actions as $method => [$nonce, $cap]) {
            $this->build();
            $this->wp->post = false;
            $this->assertSame(405, $this->denial(fn () => $this->actions->$method())->httpStatus, $method . ' needs POST');

            $this->wp->post = true;
            $this->wp->caps = array_values(array_diff(['manage_options', 'manage_woocommerce'], [$cap]));
            $this->assertSame(403, $this->denial(fn () => $this->actions->$method())->httpStatus, $method . ' needs ' . $cap);

            $this->wp->caps = ['manage_options', 'manage_woocommerce'];
            $this->wp->params['_wpnonce'] = 'forged';
            $this->assertStringContains('expired', $this->denial(fn () => $this->actions->$method())->getMessage());
            $this->wp->nonceValid = false;
            $this->wp->params['_wpnonce'] = 'nonce-' . $nonce;
            $this->denial(fn () => $this->actions->$method());
        }
        $this->assertCount(0, $this->tokens->tokens === null ? [] : [1], 'nothing was connected by any denied request');
    }

    public function testConnectStoresASingleUseStateAndSendsTheAdminToEtsyWithPkce(): void
    {
        $this->wp->params['_wpnonce'] = 'nonce-kcpw_etsy_connect';
        $url = $this->redirectOf(fn () => $this->actions->connect());
        $parts = parse_url($url);
        $this->assertSame('www.etsy.com', $parts['host']);
        parse_str($parts['query'], $q);
        $this->assertSame('shops_r listings_r', $q['scope']);
        $this->assertSame('S256', $q['code_challenge_method']);
        $this->assertTrue($this->pending->take($q['state']) !== null, 'the state was stored');
        $this->assertNull($this->pending->take($q['state']), 'and it is single use');
    }

    public function testConnectWithoutConfigurationExplainsInsteadOfFailing(): void
    {
        $this->build(false);
        $this->wp->params['_wpnonce'] = 'nonce-kcpw_etsy_connect';
        $url = $this->redirectOf(fn () => $this->actions->connect());
        $this->assertStringContains('notice=not_configured', $url);
    }

    public function testTheCallbackRejectsUnknownReusedAndMissingStateBeforeDoingAnything(): void
    {
        $this->assertSame(400, $this->denial(fn () => $this->actions->oauthCallback('nope', 'code', null))->httpStatus);
        $this->assertSame(400, $this->denial(fn () => $this->actions->oauthCallback(null, 'code', null))->httpStatus);
        $this->assertSame(400, $this->denial(fn () => $this->actions->oauthCallback('', 'code', null))->httpStatus);
        $this->assertCount(0, $this->oauthTransport->requests, 'no token exchange without a valid state');
        $this->assertNull($this->tokens->tokens);
    }

    public function testTheCallbackExchangesTheCodeStoresTokensAndTheShop(): void
    {
        $this->pending->put('state-1', 'verifier-1', 'owner (admin)');
        $this->oauthTransport->queue(FakeTransport::json(['access_token' => '7.fresh', 'refresh_token' => 'r', 'expires_in' => 3600]));
        $url = $this->redirectOf(fn () => $this->actions->oauthCallback('state-1', 'auth-code', null));
        $this->assertStringContains('notice=connected', $url);
        $this->assertSame('7.fresh', $this->tokens->tokens->accessToken);
        $this->assertSame(99, $this->settings->get('shop_id'));
        $this->assertSame('KCPrintWorks', $this->settings->get('shop_name'));
        parse_str((string) $this->oauthTransport->requests[0]->body, $form);
        $this->assertSame('verifier-1', $form['code_verifier']);

        $this->denial(fn () => $this->actions->oauthCallback('state-1', 'auth-code', null)); // replay
    }

    public function testADeclinedOrFailedExchangeConnectsNothing(): void
    {
        $this->pending->put('s2', 'v', 'owner');
        $url = $this->redirectOf(fn () => $this->actions->oauthCallback('s2', null, 'access_denied'));
        $this->assertStringContains('notice=etsy_declined', $url);

        $this->pending->put('s3', 'v', 'owner');
        $this->oauthTransport->queue(FakeTransport::json(['error' => 'invalid_grant'], 400));
        $url = $this->redirectOf(fn () => $this->actions->oauthCallback('s3', 'bad-code', null));
        $this->assertStringContains('notice=exchange_failed', $url);
        $this->assertNull($this->tokens->tokens);
    }

    public function testDisconnectDeletesTokensSettingsAndPendingWork(): void
    {
        $this->tokens->save(new TokenSet('7.t', 'r', 4_000_000_000, ['shops_r'], 1));
        $this->settings->set('shop_id', 99);
        $this->wp->params['_wpnonce'] = 'nonce-kcpw_etsy_disconnect';
        $this->redirectOf(fn () => $this->actions->disconnect());
        $this->assertNull($this->tokens->tokens);
        $this->assertNull($this->settings->get('shop_id'));
        $this->assertTrue($this->scheduler->cancelled);
    }

    public function testTestConnectionRecordsAShapeCheckAgainstTheResponses(): void
    {
        $this->tokens->save(new TokenSet('7.t', 'r', 4_000_000_000, ['shops_r'], 1));
        $this->wp->params['_wpnonce'] = 'nonce-kcpw_etsy_test';
        $this->redirectOf(fn () => $this->actions->testConnection());
        $test = $this->settings->get('last_test');
        $this->assertTrue($test['ok']);
        $names = array_column($test['checks'], 'name');
        $this->assertContains('Listing, inventory, and image shape', $names);
        foreach ($this->apiTransport->requests as $request) {
            $this->assertSame('GET', $request->method);
        }
    }

    public function testRefreshNeedsAConnectionThenDownloadsAndSchedulesTheBackgroundBatches(): void
    {
        $this->wp->params['_wpnonce'] = 'nonce-kcpw_etsy_refresh';
        $this->assertStringContains('notice=not_connected', $this->redirectOf(fn () => $this->actions->refreshSnapshot()));

        $this->tokens->save(new TokenSet('7.t', 'r', 4_000_000_000, ['shops_r'], 1));
        $this->settings->set('shop_id', 99);
        $this->assertStringContains('notice=refresh_started', $this->redirectOf(fn () => $this->actions->refreshSnapshot()));
        $this->assertSame(1, $this->snapshots->count());
        $this->assertSame(1, $this->scheduler->scheduled);

        $this->actions->runBatch();
        $this->assertSame([], $this->snapshots->pendingDetailIds(10), 'the background batch fetched inventory and images');
    }

    public function testSavingDecisionsWritesOnlyTheDecisionTableAndRejectsAnythingInvalid(): void
    {
        $this->snapshots->saveListing(555, Fixtures::rawListing(555));
        $this->snapshots->saveListing(556, Fixtures::rawListing(556));
        $this->snapshots->saveListing(557, Fixtures::rawListing(557));
        $this->wp->params['_wpnonce'] = 'nonce-kcpw_etsy_decisions';
        $this->wp->arrays['decision'] = [
            '555' => 'link:10',          // valid
            '556' => 'link:99999',       // no such Woo product
            '557' => 'ignore',           // valid
            '999' => 'ignore',           // no such Etsy listing
            'abc' => 'ignore',           // not a listing id
            '558' => 'delete:10',        // not a decision
        ];
        $url = $this->redirectOf(fn () => $this->actions->saveDecisions());
        $this->assertStringContains('saved=2', $url);
        $this->assertSame(Decision::LINK, $this->decisions->all()[555]->type);
        $this->assertSame(10, $this->decisions->all()[555]->wooProductId);
        $this->assertSame('owner (admin)', $this->decisions->all()[555]->decidedBy);
        $this->assertSame(Decision::IGNORE, $this->decisions->all()[557]->type);
        $this->assertCount(2, $this->decisions->all());
    }

    public function testDownloadsNeedTheCapabilityAndAFreshNonceAndAreReadOnly(): void
    {
        $this->snapshots->saveListing(555, Fixtures::rawListing(555));
        $this->wp->params['_wpnonce'] = 'nonce-kcpw_etsy_download';
        $csv = $this->actions->matchesDownload();
        $this->assertStringContains('etsy_listing_id,etsy_title', $csv->body);
        $this->assertSame('text/csv; charset=utf-8', $csv->contentType);
        $json = $this->actions->snapshotDownload();
        $this->assertSame(555, json_decode($json->body, true)[0]['listing']['listing_id']);

        $this->wp->caps = [];
        $this->denial(fn () => $this->actions->matchesDownload());
        $this->wp->caps = ['manage_woocommerce'];
        $this->wp->params['_wpnonce'] = 'stale';
        $this->denial(fn () => $this->actions->snapshotDownload());
    }
}
