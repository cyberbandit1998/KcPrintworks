<?php
declare(strict_types=1);

/**
 * Minimal stand-ins for the few WordPress and WooCommerce functions the plugin calls. They follow the documented behavior of the
 * real ones; they are NOT the real ones, so the plugin is only proven on a real site by the preview step in docs/CHECKOUT-STYLE.md.
 */

namespace {
    if (!defined('ABSPATH')) {
        define('ABSPATH', '/tmp/wp/');
    }

    final class WpStub
    {
        /** @var array<string, list<array{callable, int}>> */
        public static array $actions = [];
        /** @var array<string, list<callable>> */
        public static array $filters = [];
        public static int $currentPageId = 0;
        public static bool $isAdmin = false;
        public static bool $orderReceived = false;
        /** @var list<string> */
        public static array $registeredStyles = [];
        /** @var list<array{handle: string, src: string, deps: array<int, string>, ver: string}> */
        public static array $enqueued = [];

        public static function reset(): void
        {
            self::$actions = self::$filters = self::$registeredStyles = self::$enqueued = [];
            self::$currentPageId = 0;
            self::$isAdmin = false;
            self::$orderReceived = false;
        }

        public static function run(string $hook): string
        {
            ob_start();
            foreach (self::$actions[$hook] ?? [] as [$callback]) {
                $callback();
            }
            return (string) ob_get_clean();
        }

        public static function filter(string $hook, mixed $value): mixed
        {
            foreach (self::$filters[$hook] ?? [] as $callback) {
                $value = $callback($value);
            }
            return $value;
        }
    }

    function add_action(string $hook, callable $callback, int $priority = 10): void
    {
        WpStub::$actions[$hook][] = [$callback, $priority];
    }
    function add_filter(string $hook, callable $callback): void
    {
        WpStub::$filters[$hook][] = $callback;
    }
    function is_page(int|string|array $page = ''): bool
    {
        return $page === WpStub::$currentPageId;
    }
    function current_user_can(string $capability): bool
    {
        return WpStub::$isAdmin && $capability === 'manage_options';
    }
    function is_wc_endpoint_url(string $endpoint = ''): bool
    {
        return WpStub::$orderReceived && $endpoint === 'order-received';
    }
    function wc_get_cart_url(): string
    {
        return 'https://shop.example.com/cart/';
    }
    function home_url(string $path = ''): string
    {
        return 'https://shop.example.com' . $path;
    }
    function plugins_url(string $path, string $file): string
    {
        return 'https://shop.example.com/wp-content/plugins/kcpw-checkout-style/' . $path;
    }
    function wp_style_is(string $handle, string $list = 'enqueued'): bool
    {
        return $list === 'registered' && in_array($handle, WpStub::$registeredStyles, true);
    }
    /** @param array<int, string> $deps */
    function wp_enqueue_style(string $handle, string $src, array $deps = [], string $ver = ''): void
    {
        WpStub::$enqueued[] = ['handle' => $handle, 'src' => $src, 'deps' => $deps, 'ver' => $ver];
    }
}
