<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Tests;

require_once __DIR__ . '/wp-stubs.php';

use KcPrintworks\Etsy\Oauth\TokenSet;
use KcPrintworks\Etsy\Wp\Config;
use KcPrintworks\Etsy\Wp\Plugin;
use KcPrintworks\Etsy\Wp\WpGateway;
use KcPrintworks\Etsy\Wp\WpOptionLock;
use KcPrintworks\Etsy\Wp\WpPendingAuthStore;
use KcPrintworks\Etsy\Wp\WpRunStateStore;
use KcPrintworks\Etsy\Wp\WpScheduler;
use KcPrintworks\Etsy\Wp\WpSettingsStore;
use KcPrintworks\Etsy\Wp\WpTokenStore;
use KcPrintworks\Etsy\Wp\WpTransport;
use KcPrintworks\Etsy\Http\Request;
use KcPrintworks\Etsy\Snapshot\RunState;

/**
 * Exercises the thin WordPress glue against stand-in WordPress functions (tests/wp-stubs.php): configuration, encrypted
 * token storage, the OAuth state store, the hooks the plugin registers, and the whole connect and callback flow.
 * It cannot prove anything about real WordPress (the database stores and WooCommerce reader are not run here); the
 * first install on a staging site does that.
 */
final class WpGlueTest extends TestCase
{
    private static bool $configured = false;

    private function configure(): void
    {
        \WpStubState::reset();
        if (!self::$configured) {
            define('KCPW_ETSY_API_KEY', 'test-keystring');
            define('KCPW_ETSY_ENC_KEY', 'a-long-random-encryption-key-for-tests-0123456789');
            self::$configured = true;
        }
    }

    public function testConfigurationListsWhatIsMissingBeforeAnythingIsDefined(): void
    {
        \WpStubState::reset();
        if (!self::$configured) {
            $this->assertSame(['KCPW_ETSY_API_KEY', 'KCPW_ETSY_ENC_KEY'], Config::missing());
        }
        $this->configure();
        $this->assertSame([], Config::missing());
        $this->assertSame('test-keystring', Config::apiKeyHeader()->value());
        $this->assertSame(['shops_r', 'listings_r'], Config::oauth('https://shop.example.com/cb')->scopes);
    }

    public function testTokensAreStoredEncryptedAndComeBackIntact(): void
    {
        $this->configure();
        $store = new WpTokenStore();
        $this->assertNull($store->load());
        $store->save(new TokenSet('7.very-secret-access', 'very-secret-refresh', 1_800_003_600, ['shops_r', 'listings_r'], 1_800_000_000));
        $stored = (string) \WpStubState::$options[WpTokenStore::OPTION];
        $this->assertStringNotContains('very-secret', $stored);
        $this->assertSame('7.very-secret-access', $store->load()->accessToken);
        $store->clear();
        $this->assertNull($store->load());

        \WpStubState::$options[WpTokenStore::OPTION] = 'v1.corrupted';
        $this->assertNull($store->load(), 'an unreadable value means "not connected", never a crash');
    }

    public function testPendingAuthStateIsSingleUse(): void
    {
        $this->configure();
        $store = new WpPendingAuthStore();
        $store->put('state-abc', 'verifier', 'owner');
        foreach (array_keys(\WpStubState::$transients) as $key) {
            $this->assertStringNotContains('state-abc', $key, 'the raw state is not stored in a key');
        }
        $this->assertSame('verifier', $store->take('state-abc')['verifier']);
        $this->assertNull($store->take('state-abc'));
        $this->assertNull($store->take('other'));
    }

    public function testSettingsRunStateSchedulerAndLock(): void
    {
        $this->configure();
        $settings = new WpSettingsStore();
        $settings->set('shop_id', 99);
        $this->assertSame(99, $settings->get('shop_id'));
        $settings->delete('shop_id');
        $this->assertSame('x', $settings->get('shop_id', 'x'));

        $runs = new WpRunStateStore();
        $runs->save(new RunState(RunState::DONE, 'a', 'b', 3));
        $this->assertSame(3, $runs->load()->listings);

        $scheduler = new WpScheduler();
        $scheduler->scheduleBatch(2);
        $scheduler->scheduleBatch(2);
        $this->assertCount(1, \WpStubState::$scheduled[WpScheduler::BATCH_HOOK], 'one pending batch at a time');
        $scheduler->cancel();
        $this->assertFalse(isset(\WpStubState::$scheduled[WpScheduler::BATCH_HOOK]));

        $result = (new WpOptionLock())->synchronized('etsy-token-refresh', static fn (): string => 'done');
        $this->assertSame('done', $result);
        $this->assertSame([], array_filter(array_keys(\WpStubState::$options), static fn (string $k): bool => str_starts_with($k, 'kcpw_etsy_lock_')), 'the lock is released');
    }

    public function testTheTransportMapsWordPressResponsesAndErrorsWithoutLeakingHeaders(): void
    {
        $this->configure();
        \WpStubState::$remote[] = ['code' => 200, 'body' => '{"ok":true}', 'headers' => ['X-Remaining-Today' => '5']];
        $response = (new WpTransport())->send(new Request('GET', 'https://api.etsy.com/v3/application/users/me', ['Authorization' => 'Bearer secret']));
        $this->assertSame(200, $response->status);
        $this->assertSame('5', $response->header('x-remaining-today'));
        $this->assertSame(0, (new WpTransport())->send(new Request('GET', 'https://api.etsy.com/v3/application/users/me'))->status, 'a network error becomes status 0');
        $this->assertFalse(\WpStubState::$remoteCalls[0]['args']['redirection'] > 0, 'redirects are never followed');
    }

    public function testThePluginRegistersItsMenuHandlersRouteAndBackgroundHooks(): void
    {
        $this->configure();
        Plugin::boot();
        foreach (['admin_menu', 'rest_api_init', 'admin_post_kcpw_etsy_connect', 'admin_post_kcpw_etsy_disconnect', 'admin_post_kcpw_etsy_test', 'admin_post_kcpw_etsy_refresh', 'admin_post_kcpw_etsy_decisions', 'admin_post_kcpw_etsy_download_matches', 'admin_post_kcpw_etsy_download_snapshot', WpScheduler::BATCH_HOOK, WpScheduler::DAILY_HOOK, 'init'] as $hook) {
            $this->assertTrue(isset(\WpStubState::$actions[$hook]), 'missing hook ' . $hook);
        }
        foreach (\WpStubState::$actions['admin_menu'] as $callback) {
            $callback();
        }
        $this->assertSame(['woocommerce', 'kcpw-etsy', 'manage_woocommerce'], \WpStubState::$actions['__submenu'][0]);
        foreach (\WpStubState::$actions['rest_api_init'] as $callback) {
            $callback();
        }
        $route = \WpStubState::$restRoutes['kcpw-etsy/v1/oauth/callback'];
        $this->assertSame('GET', $route['methods']);
    }

    public function testTheWholeConnectFlowThroughTheRealGlue(): void
    {
        $this->configure();
        Plugin::boot();

        // 1. The administrator clicks Connect (POST with the nonce).
        $_SERVER['REQUEST_METHOD'] = 'POST';
        $_POST['_wpnonce'] = 'stub-kcpw_etsy_connect';
        $stop = $this->assertThrows(\WpStubStop::class, fn () => ($this->hook('admin_post_kcpw_etsy_connect'))());
        $this->assertSame('redirect', $stop->kind);
        $this->assertStringContains('https://www.etsy.com/oauth/connect?', $stop->detail);
        parse_str((string) parse_url($stop->detail, PHP_URL_QUERY), $q);
        $this->assertSame('S256', $q['code_challenge_method']);

        // 2. Etsy sends the browser back to the REST route.
        \WpStubState::$remote[] = ['code' => 200, 'body' => json_encode(['access_token' => '7.access', 'refresh_token' => 'refresh', 'expires_in' => 3600]), 'headers' => []];
        \WpStubState::$remote[] = ['code' => 200, 'body' => json_encode(['user_id' => 7, 'shop_id' => 99]), 'headers' => []];
        \WpStubState::$remote[] = ['code' => 200, 'body' => json_encode(['shop_name' => 'KCPrintWorks']), 'headers' => []];
        foreach (\WpStubState::$actions['rest_api_init'] as $callback) {
            $callback();
        }
        $callbackHandler = \WpStubState::$restRoutes['kcpw-etsy/v1/oauth/callback']['callback'];
        $stop = $this->assertThrows(\WpStubStop::class, fn () => $callbackHandler(new \WP_REST_Request(['state' => $q['state'], 'code' => 'the-code'])));
        $this->assertStringContains('notice=connected', $stop->detail);
        $this->assertSame('POST', \WpStubState::$remoteCalls[0]['args']['method']);
        $this->assertSame('GET', \WpStubState::$remoteCalls[1]['args']['method']);
        $this->assertSame('7.access', (new WpTokenStore())->load()->accessToken);
        $this->assertSame(99, (new WpSettingsStore())->get('shop_id'));
        foreach (\WpStubState::$remoteCalls as $call) {
            $this->assertTrue(in_array($call['args']['method'], ['GET', 'POST'], true));
            $this->assertStringContains('etsy.com', $call['url']);
        }

        // 3. A replayed callback is refused.
        $replay = $this->assertThrows(\WpStubStop::class, fn () => $callbackHandler(new \WP_REST_Request(['state' => $q['state'], 'code' => 'the-code'])));
        $this->assertSame('die', $replay->kind);
        $this->assertSame(400, $replay->status);
    }

    public function testAnUnprivilegedUserCannotConnectOrDisconnect(): void
    {
        $this->configure();
        Plugin::boot();
        \WpStubState::$caps = ['read'];
        $_SERVER['REQUEST_METHOD'] = 'POST';
        $_POST['_wpnonce'] = 'stub-kcpw_etsy_connect';
        $stop = $this->assertThrows(\WpStubStop::class, fn () => ($this->hook('admin_post_kcpw_etsy_connect'))());
        $this->assertSame('die', $stop->kind);
        $this->assertSame(403, $stop->status);
        $this->assertSame([], \WpStubState::$transients, 'no OAuth state was created');
    }

    public function testGatewayParametersAreSanitized(): void
    {
        $this->configure();
        $gateway = new WpGateway();
        $_POST['x'] = '  <b>hi</b>  ';
        $_POST['decision'] = ['123' => 'link:5', '456' => ['nested'], 'bad key!' => 'ignore'];
        $this->assertSame('hi', $gateway->param('x'));
        $this->assertSame(['123' => 'link:5', 'badkey' => 'ignore'], $gateway->params('decision'));
        $this->assertNull($gateway->param('missing'));
    }

    private function hook(string $name): callable
    {
        return \WpStubState::$actions[$name][0];
    }
}
