<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Admin;

use KcPrintworks\Etsy\Api\EtsyClient;
use KcPrintworks\Etsy\Match\Decision;
use KcPrintworks\Etsy\Match\DecisionStore;
use KcPrintworks\Etsy\Oauth\AuthorizationRequest;
use KcPrintworks\Etsy\Oauth\NeedsReauth;
use KcPrintworks\Etsy\Oauth\OAuthClient;
use KcPrintworks\Etsy\Oauth\OAuthConfig;
use KcPrintworks\Etsy\Oauth\OAuthError;
use KcPrintworks\Etsy\Oauth\TokenStore;
use KcPrintworks\Etsy\Report\MatchCsv;
use KcPrintworks\Etsy\Report\Snapshot;
use KcPrintworks\Etsy\Snapshot\Collector;
use KcPrintworks\Etsy\Snapshot\SnapshotStore;
use KcPrintworks\Etsy\Woo\WooReader;

/**
 * The admin actions. Every one of them checks (in this order) the HTTP method, the capability, and the nonce before it
 * does anything, and none of them can create, change, or delete a WooCommerce product: the only things they write are
 * this plugin's own tokens, settings, snapshot, and decisions.
 */
final class Actions
{
    public const CAP_CONNECT = 'manage_options';
    public const CAP_REVIEW = 'manage_woocommerce';

    /**
     * @param callable():OAuthConfig $oauthConfig  throws InvalidArgumentException when the app is not configured
     * @param callable(OAuthConfig):OAuthClient $oauthClient
     * @param callable():EtsyClient $etsyClient
     * @param callable():Collector $collector
     */
    public function __construct(
        private readonly Gateway $wp,
        private $oauthConfig,
        private readonly PendingAuthStore $pending,
        private $oauthClient,
        private readonly TokenStore $tokens,
        private $etsyClient,
        private readonly SettingsStore $settings,
        private $collector,
        private readonly DecisionStore $decisions,
        private readonly SnapshotStore $snapshots,
        private readonly WooReader $woo,
        private readonly Scheduler $scheduler,
        private readonly PreviewService $preview,
    ) {
    }

    /** @param array<string,string|int> $args */
    private function back(string $tab, array $args = []): never
    {
        $this->wp->redirect($this->wp->adminUrl($tab, $args));
        throw new \LogicException('redirect() must not return');
    }

    private function guard(string $capability, string $action): void
    {
        if (!$this->wp->isPost()) {
            $this->wp->deny('This action must be submitted from the plugin screen.', 405);
        }
        if (!$this->wp->can($capability)) {
            $this->wp->deny('You are not allowed to do that.', 403);
        }
        if (!$this->wp->verifyNonce($this->wp->param('_wpnonce'), $action)) {
            $this->wp->deny('The form expired. Go back, reload the page, and try again.', 403);
        }
    }

    /** Step 1 of connecting: send the signed-in administrator to Etsy to approve read-only access. */
    public function connect(): void
    {
        $this->guard(self::CAP_CONNECT, 'kcpw_etsy_connect');
        try {
            $config = ($this->oauthConfig)();
        } catch (\InvalidArgumentException) {
            $this->back('connection', ['notice' => 'not_configured']);
        }
        $request = AuthorizationRequest::begin($config);
        $this->pending->put($request->state, $request->codeVerifier, $this->wp->userLabel());
        $this->wp->redirect($request->url);
    }

    /**
     * Step 2: Etsy sends the browser back here. There is no logged-in check (the REST route is public by necessity);
     * the single-use `state` that only the administrator's own Connect click created is what authorizes this request.
     */
    public function oauthCallback(?string $state, ?string $code, ?string $error): void
    {
        $entry = ($state !== null && $state !== '') ? $this->pending->take($state) : null;
        if ($entry === null) {
            $this->wp->deny('This connection request is unknown or has expired. Start again from the plugin screen.', 400);
        }
        if ($error !== null && $error !== '') {
            $this->back('connection', ['notice' => 'etsy_declined']);
        }
        if ($code === null || $code === '') {
            $this->back('connection', ['notice' => 'exchange_failed']);
        }
        try {
            $config = ($this->oauthConfig)();
            /** @var OAuthClient $oauth */
            $oauth = ($this->oauthClient)($config);
            $this->tokens->save($oauth->exchangeCode($code, $entry['verifier']));
        } catch (NeedsReauth | OAuthError | \InvalidArgumentException) {
            $this->back('connection', ['notice' => 'exchange_failed']);
        }
        $this->settings->set('connected_at', $this->wp->now());
        $this->settings->set('connected_by', $entry['user']);
        try {
            /** @var EtsyClient $client */
            $client = ($this->etsyClient)();
            $me = $client->getMe();
            if (isset($me['shop_id'])) {
                $this->settings->set('shop_id', (int) $me['shop_id']);
            }
            if (isset($me['user_id'])) {
                $this->settings->set('user_id', (int) $me['user_id']);
            }
            if (isset($me['shop_id'])) {
                $shop = $client->getShop((int) $me['shop_id']);
                $this->settings->set('shop_name', (string) ($shop['shop_name'] ?? ''));
            }
        } catch (\Throwable) {
            // Connected, but the account lookup failed: the connection screen's "Test connection" explains why.
            $this->settings->set('shop_name', '');
        }
        $this->back('connection', ['notice' => 'connected']);
    }

    public function disconnect(): void
    {
        $this->guard(self::CAP_CONNECT, 'kcpw_etsy_disconnect');
        $this->tokens->clear();
        $this->scheduler->cancel();
        foreach (['shop_id', 'user_id', 'shop_name', 'connected_at', 'connected_by', 'last_test'] as $key) {
            $this->settings->delete($key);
        }
        $this->back('connection', ['notice' => 'disconnected']);
    }

    public function testConnection(): void
    {
        $this->guard(self::CAP_REVIEW, 'kcpw_etsy_test');
        /** @var EtsyClient $client */
        $client = ($this->etsyClient)();
        $shopId = $this->settings->get('shop_id');
        $this->settings->set('last_test', Diagnostics::run($client, is_int($shopId) ? $shopId : null, $this->wp->now()));
        $this->back('connection', ['notice' => 'tested']);
    }

    public function refreshSnapshot(): void
    {
        $this->guard(self::CAP_REVIEW, 'kcpw_etsy_refresh');
        $shopId = $this->settings->get('shop_id');
        if (!is_int($shopId) || !$this->tokens->load()) {
            $this->back('connection', ['notice' => 'not_connected']);
        }
        /** @var Collector $collector */
        $collector = ($this->collector)();
        $collector->start($shopId, Collector::DEFAULT_STATES, 'manual');
        $this->scheduler->scheduleBatch(1);
        $this->back('preview', ['notice' => 'refresh_started']);
    }

    /** The optional daily download (only when KCPW_ETSY_AUTO_REFRESH is on). Reads from Etsy; changes nothing in WooCommerce. */
    public function scheduledRefresh(): void
    {
        $shopId = $this->settings->get('shop_id');
        if (!is_int($shopId) || $this->tokens->load() === null) {
            return;
        }
        /** @var Collector $collector */
        $collector = ($this->collector)();
        $collector->start($shopId, Collector::DEFAULT_STATES, 'schedule');
        $this->scheduler->scheduleBatch(1);
    }

    /** One background step of the snapshot (called by the scheduler, not by a browser). */
    public function runBatch(): void
    {
        /** @var Collector $collector */
        $collector = ($this->collector)();
        $state = $collector->batch();
        if ($state->phase === \KcPrintworks\Etsy\Snapshot\RunState::DETAILS) {
            $this->scheduler->scheduleBatch(2);
        }
    }

    /**
     * Records the owner's decisions from the preview form. Only the plugin's own decision table is written.
     * Accepts decision[<etsy listing id>] = "link:<woo product id>" | "ignore" | "create_new" | "clear".
     */
    public function saveDecisions(): void
    {
        $this->guard(self::CAP_REVIEW, 'kcpw_etsy_decisions');
        $known = [];
        foreach ($this->snapshots->all() as $row) {
            $known[(int) ($row['listing']['listing_id'] ?? 0)] = true;
        }
        $wooIds = [];
        foreach ($this->woo->products() as $product) {
            $wooIds[$product->id] = true;
        }

        $saved = 0;
        $skipped = 0;
        foreach ($this->wp->params('decision') as $listingKey => $choice) {
            $listingId = ctype_digit((string) $listingKey) ? (int) $listingKey : 0;
            if ($listingId === 0 || !isset($known[$listingId])) {
                $skipped++;
                continue;
            }
            $choice = trim($choice);
            if ($choice === '' || $choice === 'keep') {
                continue;
            }
            if ($choice === 'clear') {
                $this->decisions->remove($listingId);
                $saved++;
                continue;
            }
            try {
                if ($choice === 'ignore') {
                    $decision = new Decision($listingId, Decision::IGNORE, null, $this->wp->userLabel(), $this->wp->now());
                } elseif ($choice === 'create_new') {
                    $decision = new Decision($listingId, Decision::CREATE_NEW, null, $this->wp->userLabel(), $this->wp->now());
                } elseif (preg_match('/^link:(\d+)$/', $choice, $m) === 1 && isset($wooIds[(int) $m[1]])) {
                    $decision = new Decision($listingId, Decision::LINK, (int) $m[1], $this->wp->userLabel(), $this->wp->now());
                } else {
                    $skipped++;
                    continue;
                }
            } catch (\InvalidArgumentException) {
                $skipped++;
                continue;
            }
            $this->decisions->save($decision);
            $saved++;
        }
        $this->back('preview', ['notice' => 'decisions_saved', 'saved' => $saved, 'skipped' => $skipped]);
    }

    /** The raw Etsy snapshot as a download (for support, or to rerun the preview offline). */
    public function snapshotDownload(): Download
    {
        $this->guardRead('kcpw_etsy_download');
        return new Download('etsy-snapshot-' . gmdate('Ymd-His') . '.json', 'application/json; charset=utf-8', (string) json_encode($this->snapshots->all(), JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
    }

    /** The matching report as a spreadsheet with decision columns. */
    public function matchesDownload(): Download
    {
        $this->guardRead('kcpw_etsy_download');
        return new Download('etsy-matches-' . gmdate('Ymd-His') . '.csv', 'text/csv; charset=utf-8', MatchCsv::render($this->preview->build()->report));
    }

    /** Downloads are GETs from a link, so they need the capability and a nonce in the URL, not a POST. */
    private function guardRead(string $action): void
    {
        if (!$this->wp->can(self::CAP_REVIEW)) {
            $this->wp->deny('You are not allowed to do that.', 403);
        }
        if (!$this->wp->verifyNonce($this->wp->param('_wpnonce'), $action)) {
            $this->wp->deny('The link expired. Go back, reload the page, and try again.', 403);
        }
    }
}
