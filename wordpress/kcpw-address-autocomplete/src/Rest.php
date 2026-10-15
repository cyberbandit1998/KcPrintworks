<?php
declare(strict_types=1);

namespace KcPrintworks\AddressAutocomplete;

/**
 * The plugin's public REST routes. Every route is called by visitors' browsers, so what protects each one is its poverty: it cannot
 * read anything of the site's, cannot store text, and a flood is dropped by a rate limit before any work is done.
 *
 *  - `/usage` (always registered): the usage-counter beacon. Whole numbers only (see {@see Usage}); does nothing when counters are off.
 *  - `/validate` (only when the address-check module is on AND a server key is saved): asks Google's Address Validation API for a
 *    verdict. Cached a day per address, capped per day, and it answers with a verdict and a reason code only.
 *  - `/hint` (only when the owner opted in to the location hint): a country, and with an IP lookup service a rounded position, to
 *    soften the ranking of suggestions.
 *  - `/checkout-start` (only when the owner opted in to counting checkouts): adds one to a counter. Nothing else.
 *
 * Preview mode applies here too: until the plugin is Live, only a signed-in administrator (with the REST nonce the page gave them)
 * gets an answer; everyone else gets a refusal.
 */
final class Rest
{
    public const NAMESPACE = 'kcpw-aa/v1';
    public const BEACONS_PER_MINUTE = 20;
    public const VALIDATE_PER_MINUTE = 10;
    public const HINT_PER_MINUTE = 10;
    public const START_PER_MINUTE = 6;
    public const CACHE_SECONDS = DAY_IN_SECONDS;

    private readonly Http $google;
    private readonly Http $safe;
    private readonly int $cacheSeconds;

    /**
     * @param array<string, mixed> $settings
     * @param Http|null $google answers calls to Google's fixed addresses (tests pass a recorder)
     * @param Http|null $safe   answers calls to addresses an administrator typed in (a webhook, an IP lookup service)
     * @param int|null $cacheSeconds how long an address-check verdict is remembered: at most a day, 0 = never (KCPW_AA_VALIDATION_CACHE_SECONDS)
     */
    public function __construct(private readonly array $settings, ?Http $google = null, ?Http $safe = null, ?int $cacheSeconds = null)
    {
        $this->google = $google ?? new WpHttp(false);
        $this->safe = $safe ?? new WpHttp(true);
        $this->cacheSeconds = $cacheSeconds === null ? self::CACHE_SECONDS : max(0, min(self::CACHE_SECONDS, $cacheSeconds));
    }

    public function register(): void
    {
        add_action('rest_api_init', [$this, 'routes']);
    }

    public function routes(): void
    {
        register_rest_route(self::NAMESPACE, '/usage', [
            'methods' => 'POST',
            'callback' => [$this, 'usage'],
            'permission_callback' => '__return_true',
        ]);
        if ($this->validationAvailable()) {
            register_rest_route(self::NAMESPACE, '/validate', [
                'methods' => 'POST',
                'callback' => [$this, 'validate'],
                'permission_callback' => '__return_true',
            ]);
        }
        if (Settings::optInEnabled($this->settings, 'ip')) {
            register_rest_route(self::NAMESPACE, '/hint', [
                'methods' => 'GET',
                'callback' => [$this, 'hint'],
                'permission_callback' => '__return_true',
            ]);
        }
        if (Settings::optInEnabled($this->settings, 'abandonment')) {
            register_rest_route(self::NAMESPACE, '/checkout-start', [
                'methods' => 'POST',
                'callback' => [$this, 'checkoutStart'],
                'permission_callback' => '__return_true',
            ]);
        }
    }

    /** The address check needs the module switched on and a server key; without both, no route exists to be probed. */
    public function validationAvailable(): bool
    {
        return ($this->settings['modules']['validation'] ?? false) === true && trim((string) ($this->settings['server_key'] ?? '')) !== '';
    }

    public function usage(object $request): object
    {
        if (($this->settings['usage_counters'] ?? true) !== true) {
            return new \WP_REST_Response(null, 204);
        }
        if (!$this->sameSite($request)) {
            return new \WP_REST_Response(['code' => 'forbidden'], 403);
        }
        $body = (string) $request->get_body();
        if ($body === '' || strlen($body) > 2048) {
            return new \WP_REST_Response(null, 204);
        }
        $beacon = Usage::cleanBeacon(json_decode($body, true));
        if ($beacon === null) {
            return new \WP_REST_Response(null, 204);
        }
        $allowed = RateLimiter::hit(
            static fn (string $key): mixed => get_transient($key),
            static function (string $key, array $value, int $ttl): void {
                set_transient($key, $value, $ttl);
            },
            'kcpw_aa_rl_' . substr(hash('sha256', self::visitor() . wp_salt()), 0, 24),
            self::BEACONS_PER_MINUTE,
            60,
            time(),
        );
        if (!$allowed) {
            return new \WP_REST_Response(null, 204);
        }
        update_option(Usage::OPTION, Usage::record(get_option(Usage::OPTION, []), $beacon, gmdate('Y-m-d')), false);
        return new \WP_REST_Response(null, 204);
    }

    /**
     * The same gates for every feature route: this site's own pages only; nothing at all when the plugin is Off; in Preview only an
     * administrator. Returns the refusal, or null when the request may go on.
     */
    private function gate(object $request): ?\WP_REST_Response
    {
        if (!$this->sameSite($request)) {
            return new \WP_REST_Response(['code' => 'forbidden'], 403);
        }
        $mode = (string) ($this->settings['mode'] ?? Settings::MODE_OFF);
        if ($mode === Settings::MODE_OFF) {
            return new \WP_REST_Response(['code' => 'off'], 404);
        }
        if ($mode === Settings::MODE_PREVIEW && !current_user_can('manage_options')) {
            return new \WP_REST_Response(['code' => 'preview'], 403);
        }
        return null;
    }

    /** One allowance per visitor and route. */
    private function allow(string $bucket, int $perMinute): bool
    {
        return RateLimiter::hit(
            static fn (string $key): mixed => get_transient($key),
            static function (string $key, array $value, int $ttl): void {
                set_transient($key, $value, $ttl);
            },
            'kcpw_aa_rl_' . $bucket . '_' . substr(hash('sha256', self::visitor() . wp_salt()), 0, 24),
            $perMinute,
            60,
            time(),
        );
    }

    public function validate(object $request): object
    {
        $refused = $this->gate($request);
        if ($refused !== null) {
            return $refused;
        }
        if (!$this->validationAvailable()) {
            return new \WP_REST_Response(['code' => 'off'], 404);
        }
        if (!$this->allow('v', self::VALIDATE_PER_MINUTE)) {
            return new \WP_REST_Response(['verdict' => Validation::UNKNOWN, 'reason' => 'rate'], 429);
        }
        $body = (string) $request->get_body();
        $json = strlen($body) <= 2048 ? json_decode($body, true) : null;
        $address = Validation::cleanAddress($json);
        if ($address === null) {
            return new \WP_REST_Response(['verdict' => Validation::UNKNOWN, 'reason' => 'bad_request'], 400);
        }
        $formId = is_array($json) && isset($json['formId']) && is_string($json['formId']) && preg_match('/^[a-z0-9_]{3,40}$/', $json['formId']) === 1 ? $json['formId'] : '';

        $cacheKey = 'kcpw_aa_v_' . substr(hash('sha256', (string) json_encode($address) . wp_salt()), 0, 40);
        $cached = $this->cacheSeconds > 0 ? get_transient($cacheKey) : false;
        if (is_array($cached) && isset($cached['verdict'], $cached['reason'])) {
            return new \WP_REST_Response(['verdict' => (string) $cached['verdict'], 'reason' => (string) $cached['reason']], 200);
        }

        // A hard ceiling on what a day can cost, whatever visitors do. At the ceiling the answer is "unknown" and nothing is asked.
        $capKey = 'kcpw_aa_vcap_' . gmdate('Ymd');
        $used = (int) get_transient($capKey);
        if ($used >= (int) ($this->settings['validation_daily_cap'] ?? 200)) {
            return new \WP_REST_Response(['verdict' => Validation::UNKNOWN, 'reason' => 'cap'], 200);
        }
        set_transient($capKey, $used + 1, DAY_IN_SECONDS);

        $result = (new GoogleServer($this->google, (string) $this->settings['server_key']))->validate($address);
        $today = gmdate('Y-m-d');
        $stored = get_option(Usage::OPTION, []);
        $problem = Validation::errorCode($result['reason']);
        $stored = $result['verdict'] === Validation::UNKNOWN && $problem !== null
            ? Usage::record($stored, ['e' => [$problem => 1]], $today)
            : Usage::bump($stored, ['v' => 1], $today);
        update_option(Usage::OPTION, $stored, false);

        if ($result['verdict'] !== Validation::UNKNOWN) {
            if ($this->cacheSeconds > 0) {
                // Only this plugin's own three-way verdict is remembered, never Google's answer.
                set_transient($cacheKey, $result, $this->cacheSeconds);
            }
            $this->notify($result['verdict'], $address, $formId);
        }
        return new \WP_REST_Response($result, 200);
    }

    /** The opt-in webhook, once per address and kind of event per hour, and never able to slow or fail the answer. */
    private function notify(string $verdict, array $address, string $formId): void
    {
        $events = [];
        if ($verdict === Validation::BAD || $verdict === Validation::CHECK) {
            $events[] = $verdict;
        }
        if (PoBox::detectAny($address['addressLines']) !== null) {
            $events[] = 'pobox';
        }
        foreach ($events as $event) {
            if (!Webhook::wants($this->settings, $event)) {
                continue;
            }
            $once = 'kcpw_aa_wh_' . substr(hash('sha256', $event . json_encode($address) . wp_salt()), 0, 32);
            if (get_transient($once) !== false) {
                continue;
            }
            set_transient($once, 1, HOUR_IN_SECONDS);
            try {
                Webhook::send($this->safe, $this->settings, $event, (string) wp_parse_url(home_url(), PHP_URL_HOST), ['formId' => $formId, 'address' => $address]);
            } catch (\Throwable) {
                // A broken receiver must never reach the customer.
            }
        }
    }

    public function hint(object $request): object
    {
        $refused = $this->gate($request);
        if ($refused !== null) {
            return $refused;
        }
        nocache_headers();
        if (!$this->allow('h', self::HINT_PER_MINUTE)) {
            return new \WP_REST_Response(new \stdClass(), 429);
        }
        $ip = is_array($this->settings['optins']['ip'] ?? null) ? $this->settings['optins']['ip'] : [];
        $found = null;
        if (($ip['source'] ?? 'header') === 'service') {
            $found = $this->lookup((string) ($ip['service_url'] ?? ''));
        } else {
            $found = IpHint::fromHeader($_SERVER);
        }
        return new \WP_REST_Response($found ?? new \stdClass(), 200);
    }

    /** @return array{country: string, lat?: float, lng?: float}|null */
    private function lookup(string $template): ?array
    {
        $visitor = self::visitor();
        $url = IpHint::serviceUrl($template, $visitor);
        if ($url === null) {
            return null;
        }
        // Cached six hours under a one-way hash of the address, so a returning visitor is not sent to the service again.
        $key = 'kcpw_aa_ip_' . substr(hash('sha256', $visitor . wp_salt()), 0, 32);
        $cached = get_transient($key);
        if (is_array($cached)) {
            return $cached === [] ? null : $cached;
        }
        $response = $this->safe->get($url, ['Accept' => 'application/json'], 3);
        $parsed = null;
        if ($response !== null && $response['status'] === 200) {
            $data = json_decode($response['body'], true);
            $parsed = is_array($data) ? IpHint::parseService($data) : null;
        }
        set_transient($key, $parsed ?? [], $parsed === null ? 600 : 6 * HOUR_IN_SECONDS);
        return $parsed;
    }

    public function checkoutStart(object $request): object
    {
        $refused = $this->gate($request);
        if ($refused !== null) {
            return $refused;
        }
        if ($this->allow('c', self::START_PER_MINUTE)) {
            update_option(Usage::OPTION, Usage::bump(get_option(Usage::OPTION, []), ['cs' => 1], gmdate('Y-m-d')), false);
        }
        return new \WP_REST_Response(null, 204);
    }

    /** A request that names an Origin must name this site; one with no Origin (older browsers, same-origin beacons) passes. */
    private function sameSite(object $request): bool
    {
        $origin = (string) $request->get_header('origin');
        if ($origin === '') {
            return true;
        }
        $theirs = wp_parse_url($origin, PHP_URL_HOST);
        $ours = wp_parse_url(home_url(), PHP_URL_HOST);
        return is_string($theirs) && is_string($ours) && strtolower($theirs) === strtolower($ours);
    }

    private static function visitor(): string
    {
        return isset($_SERVER['REMOTE_ADDR']) ? (string) $_SERVER['REMOTE_ADDR'] : 'unknown';
    }
}
