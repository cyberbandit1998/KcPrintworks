<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Wp;

use KcPrintworks\Etsy\Admin\Actions;
use KcPrintworks\Etsy\Admin\Download;
use KcPrintworks\Etsy\Admin\EmptyMappingStore;
use KcPrintworks\Etsy\Admin\PreviewService;
use KcPrintworks\Etsy\Admin\Views;
use KcPrintworks\Etsy\Api\EtsyClient;
use KcPrintworks\Etsy\Http\ReadOnlyTransport;
use KcPrintworks\Etsy\Oauth\OAuthClient;
use KcPrintworks\Etsy\Oauth\OAuthConfig;
use KcPrintworks\Etsy\Oauth\TokenSource;
use KcPrintworks\Etsy\Snapshot\Collector;

/** Wires the plugin into WordPress: menu, admin-post handlers, the OAuth REST route, and the background steps. */
final class Plugin
{
    private WpGateway $gateway;
    private WpTokenStore $tokens;
    private WpSettingsStore $settings;
    private WpSnapshotStore $snapshots;
    private WpRunStateStore $runStates;
    private Actions $actions;
    private Views $views;
    private PreviewService $preview;

    private const ACTIONS = [
        'kcpw_etsy_connect' => 'connect',
        'kcpw_etsy_disconnect' => 'disconnect',
        'kcpw_etsy_test' => 'testConnection',
        'kcpw_etsy_refresh' => 'refreshSnapshot',
        'kcpw_etsy_decisions' => 'saveDecisions',
    ];

    public static function boot(): void
    {
        $plugin = new self();
        $plugin->hooks();
    }

    private function __construct()
    {
        $this->gateway = new WpGateway();
        $this->tokens = new WpTokenStore();
        $this->settings = new WpSettingsStore();
        $this->snapshots = new WpSnapshotStore();
        $this->runStates = new WpRunStateStore();
        $decisions = new WpDecisionStore();
        $woo = new WpWooReader();
        $this->preview = new PreviewService($this->snapshots, $woo, $decisions, new EmptyMappingStore(), $this->settings);

        $transport = new ReadOnlyTransport(new WpTransport(), EtsyClient::API_BASE, OAuthConfig::TOKEN_URL);
        $callback = $this->gateway->callbackUrl();
        $oauthConfig = static fn (): OAuthConfig => Config::oauth($callback);
        $oauthClient = static fn (OAuthConfig $config): OAuthClient => new OAuthClient($config, $transport);
        $etsyClient = fn (): EtsyClient => new EtsyClient(
            $transport,
            new TokenSource($this->tokens, $oauthClient($oauthConfig()), new WpOptionLock()),
            Config::apiKeyHeader(),
        );
        $collector = fn (): Collector => new Collector($etsyClient(), $this->snapshots, $this->runStates);

        $this->actions = new Actions(
            $this->gateway,
            $oauthConfig,
            new WpPendingAuthStore(),
            $oauthClient,
            $this->tokens,
            $etsyClient,
            $this->settings,
            $collector,
            $decisions,
            $this->snapshots,
            $woo,
            new WpScheduler(),
            $this->preview,
        );
        $this->views = new Views($this->gateway);
    }

    private function hooks(): void
    {
        \add_action('admin_menu', [$this, 'menu']);
        \add_action('rest_api_init', [$this, 'restRoutes']);
        foreach (self::ACTIONS as $hook => $method) {
            \add_action('admin_post_' . $hook, [$this->actions, $method]);
        }
        \add_action('admin_post_kcpw_etsy_download_matches', [$this, 'downloadMatches']);
        \add_action('admin_post_kcpw_etsy_download_snapshot', [$this, 'downloadSnapshot']);
        \add_action(WpScheduler::BATCH_HOOK, [$this->actions, 'runBatch']);
        \add_action(WpScheduler::DAILY_HOOK, [$this->actions, 'scheduledRefresh']);
        \add_action('init', [$this, 'ensureDailySchedule']);
        \add_filter('allowed_redirect_hosts', static fn (array $hosts): array => array_merge($hosts, ['www.etsy.com']));
    }

    public function menu(): void
    {
        \add_submenu_page('woocommerce', 'Etsy sync', 'Etsy sync', Actions::CAP_REVIEW, WpGateway::PAGE, [$this, 'render']);
    }

    public function restRoutes(): void
    {
        // Public by necessity (Etsy redirects the administrator's browser here); authorized by the single-use state.
        \register_rest_route('kcpw-etsy/v1', '/oauth/callback', [
            'methods' => 'GET',
            'permission_callback' => '__return_true',
            'callback' => function (\WP_REST_Request $request) {
                $this->actions->oauthCallback(
                    is_string($request->get_param('state')) ? $request->get_param('state') : null,
                    is_string($request->get_param('code')) ? $request->get_param('code') : null,
                    is_string($request->get_param('error')) ? $request->get_param('error') : null,
                );
                return new \WP_REST_Response(null, 204);
            },
        ]);
    }

    public function ensureDailySchedule(): void
    {
        if (Config::flag('KCPW_ETSY_AUTO_REFRESH') && !\wp_next_scheduled(WpScheduler::DAILY_HOOK)) {
            \wp_schedule_event(time() + 3600, 'daily', WpScheduler::DAILY_HOOK);
        }
    }

    public function render(): void
    {
        if (!\current_user_can(Actions::CAP_REVIEW)) {
            \wp_die(\esc_html__('You are not allowed to view this page.'), '', ['response' => 403]);
        }
        $tab = $this->gateway->param('tab') ?? 'connection';
        $tokens = $this->tokens->load();
        $vm = [
            'missing' => Config::missing(),
            'connected' => $tokens !== null,
            'shop_name' => (string) $this->settings->get('shop_name', ''),
            'shop_id' => (int) $this->settings->get('shop_id', 0),
            'scopes' => $tokens?->scopes ?? [],
            'expires_at' => $tokens !== null ? gmdate('Y-m-d H:i', $tokens->expiresAt) . ' UTC' : null,
            'connected_at' => $this->settings->get('connected_at'),
            'callback_url' => $this->gateway->callbackUrl(),
            'last_test' => $this->settings->get('last_test'),
            'requested_scopes' => \KcPrintworks\Etsy\Oauth\Scopes::PRODUCT_IMPORT,
        ];
        // The HTML is built entirely from escaped values (Admin\Html::e), so it is output as is.
        if ($tab === 'preview' || $tab === 'plan') {
            $result = $this->preview->build();
            echo $tab === 'plan' // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
                ? $this->views->plan($result, $vm)
                : $this->views->preview($result, $this->runStates->load(), $vm);
            return;
        }
        echo $this->views->connection($vm); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
    }

    public function downloadMatches(): never
    {
        $this->send($this->actions->matchesDownload());
    }

    public function downloadSnapshot(): never
    {
        $this->send($this->actions->snapshotDownload());
    }

    private function send(Download $download): never
    {
        \nocache_headers();
        header('Content-Type: ' . $download->contentType);
        header('Content-Disposition: attachment; filename="' . preg_replace('/[^A-Za-z0-9._-]/', '_', $download->filename) . '"');
        header('X-Content-Type-Options: nosniff');
        echo $download->body; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- a file download, not HTML
        exit;
    }
}
