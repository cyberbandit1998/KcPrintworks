<?php
declare(strict_types=1);

/**
 * Minimal stand-ins for the WordPress and WooCommerce functions and classes the thin glue layer (src/Wp) calls, so it can be exercised
 * without WordPress. They follow the documented behavior of the real ones; they are NOT the real ones, so the glue is only proven
 * against a real site by the staging checklist (docs/CUSTOM-QUOTES.md).
 */

namespace {
    if (!defined('ABSPATH')) {
        define('ABSPATH', '/tmp/wp/');
    }
    if (!defined('ARRAY_A')) {
        define('ARRAY_A', 'ARRAY_A');
    }
    if (!defined('KCPW_HANDOFF_SECRET')) {
        define('KCPW_HANDOFF_SECRET', '0123456789abcdef0123456789abcdef-test-secret-not-real');
    }
    if (!defined('KCPW_STOREFRONT_URL')) {
        define('KCPW_STOREFRONT_URL', 'https://storefront.example.com/');
    }

    final class WpStub
    {
        /** @var array<string,list<callable>> */
        public static array $actions = [];
        /** @var array<string,list<callable>> */
        public static array $filters = [];
        /** @var array<string,array<string,mixed>> */
        public static array $routes = [];
        public static array $transients = [];
        public static array $options = [];
        public static array $caps = ['manage_woocommerce'];
        public static array $menus = [];
        public static array $mail = [];
        public static bool $mailWorks = true;
        public static array $dies = [];
        public static string $uploads = '/tmp/kcpw-quotes-test-uploads';
        public static string $timezone = 'America/Detroit';
        public static string $currency = 'USD';
        public static int $decimals = 2;
        public static int $userId = 7;
        public static string $userName = 'Kim Owner';
        public static array $scheduled = [];
        /** @var array<int,WC_Order> */
        public static array $orders = [];
        public static int $nextOrderId = 500;
        public static bool $httpOpensProbe = false;
        public static bool $isAdmin = false;
        public static bool $failCreateOrder = false;

        public static function reset(): void
        {
            self::$actions = self::$filters = self::$routes = self::$transients = self::$options = self::$menus = self::$mail = self::$dies = self::$scheduled = self::$orders = [];
            self::$caps = ['manage_woocommerce'];
            self::$mailWorks = true;
            self::$timezone = 'America/Detroit';
            self::$currency = 'USD';
            self::$decimals = 2;
            self::$userId = 7;
            self::$nextOrderId = 500;
            self::$httpOpensProbe = false;
            self::$isAdmin = false;
            self::$failCreateOrder = false;
            $_POST = [];
            $_GET = [];
        }
    }

    final class WpStubStop extends RuntimeException
    {
        public function __construct(public readonly string $kind, public readonly string $detail)
        {
            parent::__construct($kind . ': ' . $detail);
        }
    }

    final class WP_Error
    {
        public function __construct(public string $code = '', public string $message = '', public array $data = [])
        {
        }
    }

    final class WP_REST_Request
    {
        /** @param array<string,string> $headers */
        public function __construct(private string $method, private string $route, private string $body = '', private array $headers = [])
        {
        }

        public function get_method(): string { return $this->method; }
        public function get_route(): string { return $this->route; }
        public function get_body(): string { return $this->body; }

        public function get_header(string $name): ?string
        {
            foreach ($this->headers as $k => $v) {
                if (strtolower(str_replace('_', '-', $k)) === strtolower(str_replace('_', '-', $name))) {
                    return $v;
                }
            }
            return null;
        }
    }

    final class WP_REST_Response
    {
        public array $headers = [];

        public function __construct(public mixed $data = null, public int $status = 200)
        {
        }

        public function header(string $name, string $value): void
        {
            $this->headers[$name] = $value;
        }
    }

    // ---- WooCommerce order objects (just enough of the CRUD API the gateway uses)
    class WC_Order_Item
    {
        public string $name = '';
        public string $total = '0';
        public string $taxStatus = 'taxable';
        public function set_name(string $v): void { $this->name = $v; }
        public function set_total(string $v): void { $this->total = $v; }
        public function get_total(): string { return $this->total; }
        public function set_tax_status(string $v): void { $this->taxStatus = $v; }
    }

    final class WC_Order_Item_Fee extends WC_Order_Item
    {
        public string $amount = '0';
        public function set_amount(string $v): void { $this->amount = $v; }
    }

    final class WC_Order_Item_Shipping extends WC_Order_Item
    {
        public string $methodTitle = '';
        public string $methodId = '';
        public function set_method_title(string $v): void { $this->methodTitle = $v; }
        public function set_method_id(string $v): void { $this->methodId = $v; }
    }

    final class WC_Order_Item_Product extends WC_Order_Item
    {
    }

    final class WC_Order
    {
        public int $id = 0;
        public string $status = 'pending';
        public string $currency = 'USD';
        public array $fields = [];
        public array $meta = [];
        /** @var array<string,list<WC_Order_Item>> */
        public array $items = ['line_item' => [], 'fee' => [], 'shipping' => [], 'coupon' => []];
        public array $notes = [];
        public string $total = '0.00';
        public string $totalTax = '0.00';
        public int $saves = 0;

        public function __call(string $name, array $args): mixed
        {
            if (str_starts_with($name, 'set_billing_') || str_starts_with($name, 'set_shipping_')) {
                $this->fields[substr($name, 4)] = $args[0];
                return null;
            }
            throw new \BadMethodCallException($name);
        }

        public function get_id(): int { return $this->id; }
        public function get_status(): string { return $this->status; }
        public function get_currency(): string { return $this->currency; }
        public function get_total(): string { return $this->total; }
        public function get_total_tax(): string { return $this->totalTax; }
        public function set_shipping_phone(string $v): void { $this->fields['shipping_phone'] = $v; }
        public function add_item(WC_Order_Item $item): void
        {
            $type = $item instanceof WC_Order_Item_Fee ? 'fee' : ($item instanceof WC_Order_Item_Shipping ? 'shipping' : 'line_item');
            $this->items[$type][] = $item;
        }
        public function get_items(string $type = 'line_item'): array { return $this->items[$type] ?? []; }
        public function update_meta_data(string $key, mixed $value): void { $this->meta[$key] = $value; }
        public function get_meta(string $key): mixed { return $this->meta[$key] ?? ''; }
        public function add_order_note(string $note): int { $this->notes[] = $note; return count($this->notes); }

        /** 10% tax on taxable fee lines when asked to calculate taxes, as a stand-in for a configured tax rate. */
        public function calculate_totals(bool $andTaxes = true): float
        {
            $sum = 0;
            $tax = 0;
            foreach (['fee', 'shipping'] as $type) {
                foreach ($this->items[$type] as $item) {
                    $cents = (int) round(((float) $item->total) * 100);
                    $sum += $cents;
                    if ($andTaxes && $item->taxStatus === 'taxable') {
                        $tax += intdiv($cents, 10);
                    }
                }
            }
            $this->total = number_format(($sum + $tax) / 100, 2, '.', '');
            $this->totalTax = number_format($tax / 100, 2, '.', '');
            return (float) $this->total;
        }

        public function save(): int
        {
            $this->saves++;
            if ($this->id === 0) {
                $this->id = WpStub::$nextOrderId++;
            }
            WpStub::$orders[$this->id] = $this;
            return $this->id;
        }

        public function get_checkout_payment_url(): string
        {
            return 'https://shop.example.com/checkout/order-pay/' . $this->id . '/?pay_for_order=true&key=wc_order_stub';
        }

        public function needs_payment(): bool
        {
            return (bool) apply_filters('woocommerce_order_needs_payment', in_array($this->status, ['pending', 'failed'], true), $this, ['pending', 'failed']);
        }

        public function update_status(string $to, string $note = ''): bool
        {
            $from = $this->status;
            $this->status = $to;
            if ($note !== '') {
                $this->notes[] = $note;
            }
            do_action('woocommerce_order_status_changed', $this->id, $from, $to, $this);
            return true;
        }

        public function get_edit_order_url(): string { return 'https://shop.example.com/wp-admin/post.php?post=' . $this->id . '&action=edit'; }
    }

    // ---- WordPress functions
    function add_action(string $hook, callable $callback, int $priority = 10, int $args = 1): void { WpStub::$actions[$hook][] = $callback; }
    function add_filter(string $hook, callable $callback, int $priority = 10, int $args = 1): void { WpStub::$filters[$hook][] = $callback; }
    function do_action(string $hook, mixed ...$args): void
    {
        foreach (WpStub::$actions[$hook] ?? [] as $callback) {
            $callback(...$args);
        }
    }
    function apply_filters(string $hook, mixed $value, mixed ...$args): mixed
    {
        foreach (WpStub::$filters[$hook] ?? [] as $callback) {
            $value = $callback($value, ...$args);
        }
        return $value;
    }
    function register_rest_route(string $ns, string $route, array $args): void { WpStub::$routes[$ns . $route] = $args; }
    function is_wp_error(mixed $thing): bool { return $thing instanceof WP_Error; }
    function get_option(string $key, mixed $default = false): mixed { return WpStub::$options[$key] ?? $default; }
    function update_option(string $key, mixed $value): bool { WpStub::$options[$key] = $value; return true; }
    function delete_option(string $key): bool { unset(WpStub::$options[$key]); return true; }
    function get_transient(string $key): mixed { return WpStub::$transients[$key] ?? false; }
    function set_transient(string $key, mixed $value, int $ttl = 0): bool { WpStub::$transients[$key] = $value; return true; }
    function delete_transient(string $key): bool { unset(WpStub::$transients[$key]); return true; }
    function current_user_can(string $cap, mixed ...$args): bool { return in_array($cap, WpStub::$caps, true); }
    function get_current_user_id(): int { return WpStub::$userId; }
    function wp_get_current_user(): object { return (object) ['ID' => WpStub::$userId, 'display_name' => WpStub::$userName]; }
    function wp_create_nonce(string $action): string { return 'nonce-' . $action; }
    function wp_verify_nonce(string $nonce, string $action): int|false { return $nonce === 'nonce-' . $action ? 1 : false; }
    function wp_nonce_field(string $action, string $name = '_wpnonce', bool $referer = true, bool $echo = true): string
    {
        $html = '<input type="hidden" name="' . $name . '" value="nonce-' . $action . '">';
        if ($echo) {
            echo $html;
        }
        return $html;
    }
    function sanitize_text_field(string $v): string { return trim((string) preg_replace('/\s+/', ' ', strip_tags($v))); }
    function wp_unslash(mixed $v): mixed { return $v; }
    function esc_html(string $v): string { return htmlspecialchars($v, ENT_QUOTES, 'UTF-8'); }
    function esc_attr(string $v): string { return htmlspecialchars($v, ENT_QUOTES, 'UTF-8'); }
    function esc_textarea(string $v): string { return htmlspecialchars($v, ENT_QUOTES, 'UTF-8'); }
    function esc_url(string $v): string { return preg_match('#^(https?://|/|mailto:)#i', $v) === 1 ? htmlspecialchars($v, ENT_QUOTES, 'UTF-8') : ''; }
    function esc_html__(string $text, string $domain = ''): string { return $text; }
    function admin_url(string $path = ''): string { return 'https://shop.example.com/wp-admin/' . ltrim($path, '/'); }
    function home_url(string $path = ''): string { return 'https://shop.example.com' . $path; }
    function is_ssl(): bool { return true; }
    function is_admin(): bool { return WpStub::$isAdmin; }
    function is_email(string $email): string|false { return filter_var($email, FILTER_VALIDATE_EMAIL) !== false ? $email : false; }
    function wp_timezone_string(): string { return WpStub::$timezone; }
    function wp_upload_dir(?string $time = null, bool $create = true): array { return ['basedir' => WpStub::$uploads, 'baseurl' => 'https://shop.example.com/wp-content/uploads']; }
    function wp_mkdir_p(string $dir): bool
    {
        try {
            return is_dir($dir) || mkdir($dir, 0775, true);
        } catch (\Throwable) {
            return false;
        }
    }
    function wp_raise_memory_limit(string $context = 'admin'): string|false { return false; }
    function wp_next_scheduled(string $hook): int|false { return WpStub::$scheduled[$hook] ?? false; }
    function wp_schedule_event(int $time, string $recurrence, string $hook): bool { WpStub::$scheduled[$hook] = $time; return true; }
    function wp_clear_scheduled_hook(string $hook): int { unset(WpStub::$scheduled[$hook]); return 1; }
    function wp_mail(string $to, string $subject, string $message, array|string $headers = []): bool
    {
        WpStub::$mail[] = compact('to', 'subject', 'message', 'headers');
        return WpStub::$mailWorks;
    }
    function wp_safe_redirect(string $url, int $status = 302): bool { throw new WpStubStop('redirect', $url); }
    function wp_die(string $message = '', string $title = '', array $args = []): never
    {
        WpStub::$dies[] = [$message, $args['response'] ?? 0];
        throw new WpStubStop('die', $message . ' [' . ($args['response'] ?? 0) . ']');
    }
    function add_menu_page(string $title, string $menu, string $cap, string $slug, callable $cb, string $icon = '', int $pos = 0): string { WpStub::$menus[] = compact('title', 'menu', 'cap', 'slug', 'icon', 'pos'); return $slug; }
    function wp_remote_get(string $url, array $args = []): array|WP_Error
    {
        return WpStub::$httpOpensProbe ? ['response' => ['code' => 200], 'body' => 'kcpw-quotes-probe-' . basename($url)] : ['response' => ['code' => 403], 'body' => 'denied'];
    }
    function wp_remote_retrieve_response_code(array $response): int { return (int) $response['response']['code']; }
    function wp_remote_retrieve_body(array $response): string { return (string) $response['body']; }
    function get_posts(array $args = []): array { return []; }

    // ---- WooCommerce functions
    function get_woocommerce_currency(): string { return WpStub::$currency; }
    function wc_get_price_decimals(): int { return WpStub::$decimals; }
    function wc_create_order(array $args = []): WC_Order|WP_Error
    {
        if (WpStub::$failCreateOrder) {
            return new WP_Error('woocommerce_cannot_create_order', 'No.');
        }
        $order = new WC_Order();
        $order->status = $args['status'] ?? 'pending';
        $order->currency = $args['currency'] ?? 'USD';
        $order->meta['_created_via'] = $args['created_via'] ?? '';
        $order->save();
        return $order;
    }
    function wc_get_order(int $id): WC_Order|false { return WpStub::$orders[$id] ?? false; }
    function wc_get_orders(array $args = []): array
    {
        $out = [];
        foreach (WpStub::$orders as $id => $order) {
            if (isset($args['status']) && !in_array($order->status, (array) $args['status'], true)) {
                continue;
            }
            foreach ($args['meta_query'] ?? [] as $clause) {
                if ((string) $order->get_meta($clause['key']) !== (string) $clause['value']) {
                    continue 2;
                }
            }
            $out[] = $id;
        }
        return array_slice($out, 0, (int) ($args['limit'] ?? 10));
    }
}
