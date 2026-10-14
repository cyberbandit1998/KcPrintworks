<?php
declare(strict_types=1);

/**
 * Minimal stand-ins for the WordPress functions the thin glue layer calls, so it can be exercised without WordPress.
 * Defined once, in the global namespace, only when the tests load this file.
 */

namespace {
    if (!defined('ABSPATH')) {
        define('ABSPATH', '/tmp/wp/');
    }

    final class WpStubState
    {
        public static array $options = [];
        public static array $transients = [];
        public static array $actions = [];
        public static array $filters = [];
        public static array $restRoutes = [];
        public static array $scheduled = [];
        public static array $caps = ['manage_options', 'manage_woocommerce'];
        public static array $remote = [];      // queue of canned wp_remote_request results
        public static array $remoteCalls = [];
        public static int $now = 1_800_000_000;

        public static function reset(): void
        {
            self::$options = [];
            self::$transients = [];
            self::$actions = [];
            self::$filters = [];
            self::$restRoutes = [];
            self::$scheduled = [];
            self::$caps = ['manage_options', 'manage_woocommerce'];
            self::$remote = [];
            self::$remoteCalls = [];
            $_POST = [];
            $_GET = [];
            $_SERVER['REQUEST_METHOD'] = 'GET';
        }
    }

    final class WpStubStop extends RuntimeException
    {
        public function __construct(public readonly string $kind, public readonly string $detail, public readonly int $status = 0)
        {
            parent::__construct($kind . ': ' . $detail);
        }
    }

    final class WP_Error
    {
        public function __construct(private string $message = '')
        {
        }

        public function get_error_message(): string
        {
            return $this->message;
        }
    }

    final class WP_REST_Request
    {
        public function __construct(private array $params = [])
        {
        }

        public function get_param(string $key): mixed
        {
            return $this->params[$key] ?? null;
        }
    }

    final class WP_REST_Response
    {
        public function __construct(public mixed $data = null, public int $status = 200)
        {
        }
    }

    final class WP_Term
    {
    }

    class WC_Product
    {
    }

    function get_option(string $name, mixed $default = false): mixed
    {
        return WpStubState::$options[$name] ?? $default;
    }

    function update_option(string $name, mixed $value, mixed $autoload = null): bool
    {
        WpStubState::$options[$name] = $value;
        return true;
    }

    function add_option(string $name, mixed $value = '', string $deprecated = '', mixed $autoload = null): bool
    {
        if (array_key_exists($name, WpStubState::$options)) {
            return false;
        }
        WpStubState::$options[$name] = $value;
        return true;
    }

    function delete_option(string $name): bool
    {
        unset(WpStubState::$options[$name]);
        return true;
    }

    function get_transient(string $name): mixed
    {
        return WpStubState::$transients[$name] ?? false;
    }

    function set_transient(string $name, mixed $value, int $ttl = 0): bool
    {
        WpStubState::$transients[$name] = $value;
        return true;
    }

    function delete_transient(string $name): bool
    {
        unset(WpStubState::$transients[$name]);
        return true;
    }

    function add_action(string $hook, callable $callback, int $priority = 10, int $args = 1): void
    {
        WpStubState::$actions[$hook][] = $callback;
    }

    function add_filter(string $hook, callable $callback, int $priority = 10, int $args = 1): void
    {
        WpStubState::$filters[$hook][] = $callback;
    }

    function register_rest_route(string $ns, string $route, array $args): void
    {
        WpStubState::$restRoutes[$ns . $route] = $args;
    }

    function add_submenu_page(string $parent, string $title, string $menu, string $cap, string $slug, callable $callback): void
    {
        WpStubState::$actions['__submenu'][] = [$parent, $slug, $cap];
    }

    function current_user_can(string $cap): bool
    {
        return in_array($cap, WpStubState::$caps, true);
    }

    function wp_create_nonce(string $action): string
    {
        return 'stub-' . $action;
    }

    function wp_verify_nonce(string $nonce, string $action): int|false
    {
        return $nonce === 'stub-' . $action ? 1 : false;
    }

    function wp_unslash(mixed $value): mixed
    {
        return $value;
    }

    function sanitize_text_field(string $value): string
    {
        return trim(strip_tags($value));
    }

    function sanitize_key(string $value): string
    {
        return strtolower((string) preg_replace('/[^a-zA-Z0-9_\-]/', '', $value));
    }

    function admin_url(string $path = ''): string
    {
        return 'https://shop.example.com/wp-admin/' . ltrim($path, '/');
    }

    function rest_url(string $path = ''): string
    {
        return 'https://shop.example.com/wp-json/' . ltrim($path, '/');
    }

    function add_query_arg(array $args, string $url): string
    {
        return $url . (str_contains($url, '?') ? '&' : '?') . http_build_query($args);
    }

    function wp_safe_redirect(string $url): bool
    {
        throw new WpStubStop('redirect', $url);
    }

    function wp_die(string $message = '', string $title = '', array $args = []): never
    {
        throw new WpStubStop('die', $message, (int) ($args['response'] ?? 0));
    }

    function esc_html(string $text): string
    {
        return htmlspecialchars($text, ENT_QUOTES, 'UTF-8');
    }

    function esc_html__(string $text): string
    {
        return esc_html($text);
    }

    function wp_json_encode(mixed $value): string|false
    {
        return json_encode($value);
    }

    function wp_get_current_user(): object
    {
        return new class() {
            public int $ID = 1;
            public string $user_login = 'owner';

            public function exists(): bool
            {
                return true;
            }
        };
    }

    function is_wp_error(mixed $thing): bool
    {
        return $thing instanceof WP_Error;
    }

    function wp_remote_request(string $url, array $args = []): array|WP_Error
    {
        WpStubState::$remoteCalls[] = ['url' => $url, 'args' => $args];
        $next = array_shift(WpStubState::$remote);
        if ($next === null) {
            return new WP_Error('no canned response for ' . $url);
        }
        return $next;
    }

    function wp_remote_retrieve_response_code(array $response): int
    {
        return (int) ($response['code'] ?? 0);
    }

    function wp_remote_retrieve_body(array $response): string
    {
        return (string) ($response['body'] ?? '');
    }

    function wp_remote_retrieve_headers(array $response): array
    {
        return (array) ($response['headers'] ?? []);
    }

    function wp_next_scheduled(string $hook): int|false
    {
        return WpStubState::$scheduled[$hook][0] ?? false;
    }

    function wp_schedule_single_event(int $time, string $hook): bool
    {
        WpStubState::$scheduled[$hook][] = $time;
        return true;
    }

    function wp_schedule_event(int $time, string $recurrence, string $hook): bool
    {
        WpStubState::$scheduled[$hook][] = $time;
        return true;
    }

    function wp_clear_scheduled_hook(string $hook): void
    {
        unset(WpStubState::$scheduled[$hook]);
    }
}
