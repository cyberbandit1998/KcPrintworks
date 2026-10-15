<?php
declare(strict_types=1);

namespace KcPrintworks\AddressAutocomplete;

/**
 * The plugin's public REST routes. Stage 1 has one: the usage-counter beacon. It accepts numbers only (see {@see Usage}), from the
 * site's own pages only, a few times a minute per visitor, and does nothing at all when usage counters are switched off.
 *
 * The route has to be public because it is called by visitors' browsers, so what protects it is its poverty: it cannot read anything,
 * cannot store text, and a flood of requests is dropped by the rate limit before any write.
 */
final class Rest
{
    public const NAMESPACE = 'kcpw-aa/v1';
    public const BEACONS_PER_MINUTE = 20;

    /** @param array<string, mixed> $settings */
    public function __construct(private readonly array $settings)
    {
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
