<?php
declare(strict_types=1);

/**
 * Minimal stand-ins for the WordPress and WooCommerce functions the plugin calls. They follow the documented behavior of the real
 * ones; they are NOT the real ones, so the WordPress glue is only proven on a real site by the preview step in the install guide.
 */

namespace {
    if (!defined('ABSPATH')) {
        define('ABSPATH', '/tmp/wp/');
    }

    class WP_REST_Response
    {
        public function __construct(public mixed $data = null, public int $status = 200)
        {
        }
    }

    final class WpStub
    {
        /** @var array<string, list<array{callable, int}>> */
        public static array $actions = [];
        /** @var array<string, mixed> */
        public static array $options = [];
        /** @var array<string, mixed> */
        public static array $autoload = [];
        /** @var array<string, mixed> */
        public static array $transients = [];
        /** @var list<array{handle: string, src: string, deps: array<int, string>, ver: string, args: mixed}> */
        public static array $scripts = [];
        /** @var list<array{handle: string, src: string}> */
        public static array $styles = [];
        /** @var array<string, string> */
        public static array $inline = [];
        /** @var array<string, array<string, mixed>> */
        public static array $routes = [];
        /** @var list<array{string, string}> */
        public static array $menus = [];
        /** @var list<string> */
        public static array $nonceChecks = [];
        /** @var list<string> */
        public static array $redirects = [];
        public static bool $isAdmin = false;
        public static bool $canManage = false;
        public static bool $ajax = false;
        public static int $queriedId = 0;
        public static bool $isCheckout = false;
        public static bool $isOrderReceived = false;
        public static bool $isAccount = false;
        public static bool $isEditAddress = false;
        public static string $requestUri = '/';
        public static string $locale = 'en_US';
        public static string $remoteAddr = '203.0.113.9';
        public static bool $nonceValid = true;
        /** @var array<string, mixed> */
        public static array $get = [];

        public static function reset(): void
        {
            self::$actions = self::$options = self::$autoload = self::$transients = self::$scripts = self::$styles = self::$inline = [];
            self::$routes = self::$menus = self::$nonceChecks = self::$redirects = self::$get = [];
            self::$isAdmin = self::$canManage = self::$ajax = self::$isCheckout = self::$isOrderReceived = self::$isAccount = self::$isEditAddress = false;
            self::$queriedId = 0;
            self::$requestUri = '/';
            self::$locale = 'en_US';
            self::$remoteAddr = '203.0.113.9';
            self::$nonceValid = true;
            $_GET = $_POST = [];
            $_SERVER['REQUEST_URI'] = '/';
            $_SERVER['REMOTE_ADDR'] = self::$remoteAddr;
        }

        public static function run(string $hook, mixed ...$args): void
        {
            foreach (self::$actions[$hook] ?? [] as [$callback]) {
                $callback(...$args);
            }
        }
    }

    final class WpDie extends RuntimeException
    {
    }

    function add_action(string $hook, callable $callback, int $priority = 10): void
    {
        WpStub::$actions[$hook][] = [$callback, $priority];
    }
    function is_admin(): bool
    {
        return WpStub::$isAdmin;
    }
    function wp_doing_ajax(): bool
    {
        return WpStub::$ajax;
    }
    function current_user_can(string $cap): bool
    {
        return WpStub::$canManage;
    }
    function wp_die(string $message = '', string $title = '', array $args = []): never
    {
        throw new WpDie($message);
    }
    function __(string $text, string $domain = ''): string
    {
        return $text;
    }
    function esc_html__(string $text, string $domain = ''): string
    {
        return htmlspecialchars($text, ENT_QUOTES);
    }
    function esc_html(string $text): string
    {
        return htmlspecialchars($text, ENT_QUOTES);
    }
    function esc_attr(string $text): string
    {
        return htmlspecialchars($text, ENT_QUOTES);
    }
    function sanitize_key(string $key): string
    {
        return preg_replace('/[^a-z0-9_\-]/', '', strtolower($key)) ?? '';
    }
    function wp_unslash(mixed $value): mixed
    {
        return is_array($value) ? array_map('wp_unslash', $value) : (is_string($value) ? stripslashes($value) : $value);
    }
    function wp_parse_url(string $url, int $component = -1): mixed
    {
        return parse_url($url, $component);
    }
    function home_url(string $path = ''): string
    {
        return 'https://shop.example.test' . $path;
    }
    function admin_url(string $path = ''): string
    {
        return 'https://shop.example.test/wp-admin/' . $path;
    }
    function rest_url(string $path = ''): string
    {
        return 'https://shop.example.test/wp-json/' . ltrim($path, '/');
    }
    function plugin_dir_url(string $file): string
    {
        return 'https://shop.example.test/wp-content/plugins/kcpw-address-autocomplete/';
    }
    function plugin_dir_path(string $file): string
    {
        return dirname($file) . '/';
    }
    function get_queried_object_id(): int
    {
        return WpStub::$queriedId;
    }
    function is_checkout(): bool
    {
        return WpStub::$isCheckout;
    }
    function is_order_received_page(): bool
    {
        return WpStub::$isOrderReceived;
    }
    function is_account_page(): bool
    {
        return WpStub::$isAccount;
    }
    function is_wc_endpoint_url(string $endpoint = ''): bool
    {
        return WpStub::$isEditAddress && $endpoint === 'edit-address';
    }
    function determine_locale(): string
    {
        return WpStub::$locale;
    }
    function number_format_i18n(int|float $n): string
    {
        return number_format($n);
    }
    function wp_json_encode(mixed $value, int $flags = 0): string|false
    {
        return json_encode($value, $flags);
    }
    function wp_enqueue_style(string $handle, string $src = '', array $deps = [], string|bool|null $ver = false): void
    {
        WpStub::$styles[] = ['handle' => $handle, 'src' => $src];
    }
    function wp_enqueue_script(string $handle, string $src = '', array $deps = [], string|bool|null $ver = false, mixed $args = []): void
    {
        WpStub::$scripts[] = ['handle' => $handle, 'src' => $src, 'deps' => $deps, 'ver' => (string) $ver, 'args' => $args];
    }
    function wp_add_inline_script(string $handle, string $data, string $position = 'after'): bool
    {
        WpStub::$inline[$handle . ':' . $position] = (WpStub::$inline[$handle . ':' . $position] ?? '') . $data;
        return true;
    }
    function register_rest_route(string $namespace, string $route, array $args): bool
    {
        WpStub::$routes[$namespace . $route] = $args;
        return true;
    }
    function add_menu_page(string $title, string $menu, string $cap, string $slug, ?callable $cb = null, string $icon = '', int $pos = 0): string
    {
        WpStub::$menus[] = ['page', $slug];
        return 'toplevel_page_' . $slug;
    }
    function add_submenu_page(string $parent, string $title, string $menu, string $cap, string $slug, ?callable $cb = null): string|false
    {
        WpStub::$menus[] = ['sub', $slug];
        return $parent . '_page_' . $slug;
    }
    function get_option(string $name, mixed $default = false): mixed
    {
        return WpStub::$options[$name] ?? $default;
    }
    function update_option(string $name, mixed $value, mixed $autoload = null): bool
    {
        WpStub::$options[$name] = $value;
        WpStub::$autoload[$name] = $autoload;
        return true;
    }
    function delete_option(string $name): bool
    {
        unset(WpStub::$options[$name]);
        return true;
    }
    function get_transient(string $name): mixed
    {
        return WpStub::$transients[$name] ?? false;
    }
    function set_transient(string $name, mixed $value, int $ttl = 0): bool
    {
        WpStub::$transients[$name] = $value;
        return true;
    }
    function wp_salt(string $scheme = 'auth'): string
    {
        return 'test-salt';
    }
    function wp_nonce_field(string $action, string $name = '_wpnonce', bool $referer = true, bool $echo = true): string
    {
        return '<input type="hidden" name="' . $name . '" value="nonce-for-' . $action . '">';
    }
    function check_admin_referer(string $action): int|false
    {
        WpStub::$nonceChecks[] = $action;
        if (!WpStub::$nonceValid) {
            throw new WpDie('nonce');
        }
        return 1;
    }
    function wp_safe_redirect(string $url): bool
    {
        WpStub::$redirects[] = $url;
        return true;
    }
}
