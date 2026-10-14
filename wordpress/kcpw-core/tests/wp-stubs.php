<?php
declare(strict_types=1);

/**
 * Minimal stand-ins for the WordPress and WooCommerce functions and classes the thin glue layer calls, so it can be
 * exercised without WordPress. They follow the documented behavior of the real ones; they are NOT the real ones, and the
 * glue is therefore only proven against a real site by the staging checklist (docs/CHECKOUT-STAGING-CHECKLIST.md).
 */

namespace {
    if (!defined('ABSPATH')) {
        define('ABSPATH', '/tmp/wp/');
    }
    if (!defined('KCPW_HANDOFF_SECRET')) {
        define('KCPW_HANDOFF_SECRET', '0123456789abcdef0123456789abcdef-test-secret-not-real');
    }
    if (!defined('KCPW_STOREFRONT_URL')) {
        define('KCPW_STOREFRONT_URL', 'https://staging.example.com/');
    }

    final class WpStub
    {
        public static array $actions = [];
        public static array $filters = [];
        public static array $routes = [];
        public static array $postMeta = [];
        public static array $transients = [];
        public static array $notices = [];
        public static array $products = [];
        public static array $caps = ['edit_post', 'manage_woocommerce'];
        public static array $terms = [];
        public static array $options = [];
        /** Reviews: comments that already exist, comments inserted through wp_new_comment, their meta, who bought what. */
        public static array $existingComments = [];
        public static array $newComments = [];
        public static array $commentMeta = [];
        public static array $bought = [];
        public static array $removedFilters = [];
        public static ?WP_Error $newCommentError = null;
        public static int $slashCalls = 0;
        /** What the site's own checks (settings, blocklist, spam filter) would decide before our filter runs: 1 approved, 0 held, 'spam'. */
        public static int|string $initialApproval = 1;
        public static int $nextCommentId = 500;
        public static ?WC_Cart $cart = null;
        public static ?WC_Session $session = null;
        public static int $decimals = 2;

        public static function reset(): void
        {
            self::$actions = self::$filters = self::$routes = self::$postMeta = self::$transients = self::$notices = self::$products = self::$terms = self::$options = [];
            self::$existingComments = self::$newComments = self::$commentMeta = self::$bought = self::$removedFilters = [];
            self::$newCommentError = null;
            self::$slashCalls = 0;
            self::$initialApproval = 1;
            self::$nextCommentId = 500;
            self::$caps = ['edit_post', 'manage_woocommerce'];
            self::$cart = new WC_Cart();
            self::$session = new WC_Session();
            self::$decimals = 2;
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

        public function get_error_code(): string
        {
            return $this->code;
        }
    }

    final class WP_REST_Request
    {
        /** @param array<string,string> $headers */
        public function __construct(private string $method, private string $route, private string $body = '', private array $headers = [])
        {
        }

        public function get_method(): string
        {
            return $this->method;
        }

        public function get_route(): string
        {
            return $this->route;
        }

        public function get_body(): string
        {
            return $this->body;
        }

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

    final class WP_Term
    {
        public function __construct(public string $name, public string $slug)
        {
        }
    }

    // ---- WooCommerce object stubs
    class WC_Product
    {
        public string $status = 'publish';
        public string $type = 'simple';
        public string $price = '10.00';
        public string $variationMin = '10.00';
        public string $stockStatus = 'instock';
        public bool $managing = false;
        public bool $backorders = false;
        public ?int $stockQuantity = null;
        public bool $purchasable = true;
        public bool $reviewsAllowed = true;
        public array $meta = [];
        public array $attributes = [];
        public array $children = [];

        public function __construct(public int $id = 0, public string $name = 'Product')
        {
        }

        public function get_id(): int { return $this->id; }
        public function get_name(): string { return $this->name; }
        public function get_status(): string { return $this->status; }
        public function get_type(): string { return $this->type; }
        public function get_reviews_allowed(): bool { return $this->reviewsAllowed; }
        public function get_price(string $context = 'view'): string { return $this->price; }
        public function get_variation_price(string $minMax = 'min', bool $display = false): string { return $this->variationMin; }
        public function get_stock_status(): string { return $this->stockStatus; }
        public function managing_stock(): bool { return $this->managing; }
        public function backorders_allowed(): bool { return $this->backorders; }
        public function get_stock_quantity(): ?int { return $this->stockQuantity; }
        public function is_purchasable(): bool { return $this->purchasable; }
        public function get_meta(string $key, bool $single = true): mixed { return $this->meta[$key] ?? ''; }
        public function get_attributes(): array { return $this->attributes; }
        public function get_children(): array { return $this->children; }
        public function set_price(string $price): void { $this->price = $price; $this->priceSets[] = $price; }
        /** @var list<string> */
        public array $priceSets = [];
    }

    final class WC_Product_Variation extends WC_Product
    {
        public array $variationAttributes = [];

        public function get_variation_attributes(bool $withPrefix = true): array
        {
            return $this->variationAttributes;
        }
    }

    final class WC_Product_Attribute
    {
        /** @param list<WP_Term>|list<string> $values */
        public function __construct(public string $name, public bool $taxonomy, public bool $forVariation, public array $values)
        {
        }

        public function get_name(): string { return $this->name; }
        public function is_taxonomy(): bool { return $this->taxonomy; }
        public function get_variation(): bool { return $this->forVariation; }
        public function get_terms(): array { return $this->taxonomy ? $this->values : []; }
        public function get_options(): array { return $this->taxonomy ? [] : $this->values; }
    }

    final class WC_Session
    {
        public array $data = [];
        public bool $cookie = false;

        public function get(string $key): mixed { return $this->data[$key] ?? null; }
        public function set(string $key, mixed $value): void { $this->data[$key] = $value; }
        public function set_customer_session_cookie(bool $set): void { $this->cookie = $set; }
    }

    final class WC_Cart
    {
        /** @var list<array<string,mixed>> */
        public array $added = [];
        public array $contents = [];
        public bool $failNext = false;
        public int $emptied = 0;
        public int $couponsRemoved = 0;

        public function add_to_cart(int $productId, int $quantity = 1, int $variationId = 0, array $variation = [], array $data = []): string|false
        {
            if ($this->failNext) {
                return false;
            }
            $this->added[] = compact('productId', 'quantity', 'variationId', 'variation', 'data');
            $key = md5((string) json_encode([$productId, $variationId, $variation, $data]));
            $this->contents[$key] = ['product_id' => $productId, 'variation_id' => $variationId, 'quantity' => $quantity] + $data;
            return $key;
        }

        public function empty_cart(bool $persistent = true): void { $this->emptied++; $this->contents = []; }
        public function remove_coupons(): void { $this->couponsRemoved++; }
        public function get_cart(): array { return $this->contents; }
    }

    final class WC_Order
    {
    }

    final class WC_Order_Item_Product
    {
        /** @var list<array{0:string,1:string,2:bool}> */
        public array $meta = [];

        public function add_meta_data(string $key, mixed $value, bool $unique = false): void
        {
            $this->meta[] = [$key, (string) $value, $unique];
        }
    }

    final class WC_Stub_Main
    {
        public string $version = '9.9.9';
        public ?WC_Cart $cart;
        public ?WC_Session $session;

        public function __construct()
        {
            $this->cart = WpStub::$cart;
            $this->session = WpStub::$session;
        }
    }

    // ---- WordPress functions
    function add_action(string $hook, callable $callback, int $priority = 10, int $args = 1): void { WpStub::$actions[$hook][] = $callback; }
    function add_filter(string $hook, callable $callback, int $priority = 10, int $args = 1): void { WpStub::$filters[$hook][] = $callback; }
    function remove_filter(string $hook, callable $callback, int $priority = 10): bool
    {
        foreach (WpStub::$filters[$hook] ?? [] as $index => $registered) {
            if ($registered === $callback) {
                unset(WpStub::$filters[$hook][$index]);
                WpStub::$removedFilters[] = $hook;
                return true;
            }
        }
        return false;
    }
    function apply_filters(string $hook, mixed $value, mixed ...$args): mixed
    {
        foreach (WpStub::$filters[$hook] ?? [] as $callback) {
            $value = $callback($value, ...$args);
        }
        return $value;
    }
    function is_wp_error(mixed $thing): bool { return $thing instanceof WP_Error; }
    function get_comments(array $args = []): mixed
    {
        $matches = array_filter(WpStub::$existingComments, static fn (array $c): bool => $c['post'] === $args['post_id'] && $c['email'] === $args['author_email'] && in_array($c['status'], $args['status'], true));
        return !empty($args['count']) ? count($matches) : array_values($matches);
    }
    /** Behaves like the real call in the ways that matter here: filters decide the approval, the comment is stored, an error can be forced. */
    function wp_new_comment(array $data, bool $wpError = false): int|WP_Error
    {
        if (WpStub::$newCommentError !== null) {
            return WpStub::$newCommentError;
        }
        $approved = apply_filters('pre_comment_approved', WpStub::$initialApproval, $data);
        $id = ++WpStub::$nextCommentId;
        WpStub::$newComments[$id] = $data + ['approved' => $approved, 'wpError' => $wpError, 'floodCheck' => apply_filters('comment_flood_filter', true, 0, 0, 0)];
        return $id;
    }
    function update_comment_meta(int $id, string $key, mixed $value): void { WpStub::$commentMeta[$id][$key] = $value; }
    function get_comment_meta(int $id, string $key, bool $single = false): mixed { return WpStub::$commentMeta[$id][$key] ?? ''; }
    function register_rest_route(string $ns, string $route, array $args): void { WpStub::$routes[$ns . $route] = $args; }
    function get_post_meta(int $id, string $key, bool $single = false): mixed { return WpStub::$postMeta[$id][$key] ?? ''; }
    function update_post_meta(int $id, string $key, mixed $value): void { WpStub::$postMeta[$id][$key] = $value; }
    function delete_post_meta(int $id, string $key): void { unset(WpStub::$postMeta[$id][$key]); }
    function get_transient(string $key): mixed { return WpStub::$transients[$key] ?? false; }
    function set_transient(string $key, mixed $value, int $ttl = 0): bool { WpStub::$transients[$key] = $value; return true; }
    function delete_transient(string $key): bool { unset(WpStub::$transients[$key]); return true; }
    function get_option(string $key, mixed $default = false): mixed { return WpStub::$options[$key] ?? $default; }
    function wp_nonce_field(string $action, string $name): void { echo '<input type="hidden" name="' . $name . '" value="nonce-' . $action . '">'; }
    function wp_verify_nonce(string $nonce, string $action): int|false { return $nonce === 'nonce-' . $action ? 1 : false; }
    function current_user_can(string $cap, mixed ...$args): bool { return in_array($cap, WpStub::$caps, true); }
    function get_current_user_id(): int { return 7; }
    function sanitize_text_field(string $v): string { return trim(strip_tags($v)); }
    function wp_unslash(mixed $v): mixed { return $v; }
    function wp_slash(mixed $v): mixed { WpStub::$slashCalls++; return $v; }
    function esc_html(string $v): string { return htmlspecialchars($v, ENT_QUOTES, 'UTF-8'); }
    function esc_attr(string $v): string { return htmlspecialchars($v, ENT_QUOTES, 'UTF-8'); }
    function esc_textarea(string $v): string { return htmlspecialchars($v, ENT_QUOTES, 'UTF-8'); }
    function esc_url(string $v): string { return $v; }
    function __(string $text, string $domain = ''): string { return $text; }
    function esc_html__(string $text, string $domain = ''): string { return $text; }
    function home_url(string $path = ''): string { return 'https://shop.example.com' . $path; }
    function nocache_headers(): void {}
    function is_admin(): bool { return false; }
    function wp_redirect(string $url, int $status = 302): bool { throw new WpStubStop('redirect', $url); }
    function wp_die(string $message = '', string $title = '', array $args = []): never { throw new WpStubStop('die', $message); }
    function sanitize_title(string $title): string { return trim((string) preg_replace('/[^a-z0-9_]+/', '-', strtolower($title)), '-'); }
    function has_term(string $term, string $taxonomy, int $id): bool { return in_array($term, WpStub::$terms[$id][$taxonomy] ?? [], true); }

    // ---- WooCommerce functions
    function WC(): WC_Stub_Main { return new WC_Stub_Main(); }
    function wc_get_product(int $id): WC_Product|false { return WpStub::$products[$id] ?? false; }
    function wc_customer_bought_product(string $email, int $userId, int $productId): bool { return in_array([$email, $productId], WpStub::$bought, true); }
    function wc_get_price_decimals(): int { return WpStub::$decimals; }
    function get_woocommerce_currency(): string { return 'USD'; }
    function wc_attribute_label(string $name, mixed $product = null): string { return str_starts_with($name, 'pa_') ? ucfirst(substr($name, 3)) : $name; }
    function wc_add_notice(string $message, string $type = 'success'): void { WpStub::$notices[] = [$type, $message]; }
    function wc_clear_notices(): void { WpStub::$notices = []; }
    function wc_get_checkout_url(): string { return 'https://shop.example.com/checkout/'; }
    function wc_get_cart_url(): string { return 'https://shop.example.com/cart/'; }
}
