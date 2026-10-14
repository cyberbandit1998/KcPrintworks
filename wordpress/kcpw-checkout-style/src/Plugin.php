<?php
declare(strict_types=1);

namespace KcPrintworks\CheckoutStyle;

/**
 * The only WordPress-facing code. On the checkout page (and only there) it adds a body class, one small stylesheet, and a compact
 * header; with that header it hides the theme's own header and the store-wide promo notice. It registers no route, no AJAX action,
 * no redirect, no script, and does not touch the cart, the checkout form, payment, shipping, tax or any order data.
 *
 * Hooks are added from the `wp` action, after WordPress knows which page it is showing, so every other page of the site is never
 * even looked at again.
 */
final class Plugin
{
    public const BODY_CLASS = 'kcpw-checkout';
    public const STYLE_HANDLE = 'kcpw-checkout-style';

    /**
     * What goes away when the compact header is printed: the theme's header and mobile menu (Astra), its scroll-to-top button, the
     * breadcrumb bar, and WooCommerce's store-wide notice (the usual home of an old "free shipping" banner). Because the rule is
     * printed WITH the compact header, a theme that never prints it (no wp_body_open) keeps its own header.
     */
    public const THEME_CHROME = ['#masthead', '#ast-mobile-popup-wrapper', '#ast-scroll-top', '.ast-breadcrumbs-wrapper', '.woocommerce-store-notice', 'p.demo_store'];

    /** Styles the checkout page may be printed after, when they exist, so ours wins at equal specificity. */
    private const AFTER_STYLES = ['astra-theme-css', 'wc-blocks-style', 'wc-blocks-vendors-style', 'wc-blocks-packages-style'];

    private bool $active = false;

    /**
     * @param array{mode: string, pageId: int, storefront: string, hide: list<string>} $config from Settings
     */
    public function __construct(private readonly string $file, private readonly string $version, private readonly array $config)
    {
    }

    public function register(): void
    {
        if ($this->config['mode'] === Settings::MODE_OFF) {
            return;
        }
        add_action('wp', [$this, 'onWp']);
    }

    public function onWp(): void
    {
        if (!function_exists('is_page') || !is_page($this->config['pageId'])) {
            return;
        }
        if ($this->config['mode'] === Settings::MODE_ADMINS && !current_user_can('manage_options')) {
            return;
        }
        $this->active = true;
        add_filter('body_class', [$this, 'bodyClass']);
        add_action('wp_enqueue_scripts', [$this, 'enqueue'], 100);
        add_action('wp_body_open', [$this, 'printHeader'], 5);
        // The notice's markup is replaced by nothing on this page only; the store-notice SETTING itself is never changed.
        add_filter('woocommerce_demo_store', static fn (): string => '');
    }

    public function isActive(): bool
    {
        return $this->active;
    }

    /**
     * @param array<int, string> $classes
     * @return array<int, string>
     */
    public function bodyClass(array $classes): array
    {
        $classes[] = self::BODY_CLASS;
        return $classes;
    }

    public function enqueue(): void
    {
        $path = dirname($this->file) . '/assets/checkout.css';
        $version = is_file($path) ? (string) filemtime($path) : $this->version;
        $deps = [];
        foreach (self::AFTER_STYLES as $handle) {
            // A dependency that is not registered would stop the stylesheet from printing at all, so only existing ones are named.
            if (wp_style_is($handle, 'registered')) {
                $deps[] = $handle;
            }
        }
        wp_enqueue_style(self::STYLE_HANDLE, plugins_url('assets/checkout.css', $this->file), $deps, $version);
    }

    public function printHeader(): void
    {
        $confirmation = function_exists('is_wc_endpoint_url') && is_wc_endpoint_url('order-received');
        $storefront = $this->config['storefront'];
        $brandUrl = $storefront !== '' ? $storefront . '/' : home_url('/');
        if ($confirmation) {
            $variant = HeaderMarkup::VARIANT_CONFIRMATION;
            $backUrl = $storefront !== '' ? $storefront . '/shop/' : home_url('/');
        } else {
            $variant = HeaderMarkup::VARIANT_CHECKOUT;
            $backUrl = $storefront !== '' ? $storefront . '/cart/' : (function_exists('wc_get_cart_url') ? wc_get_cart_url() : home_url('/cart/'));
        }
        $css = Settings::hideCss([...self::THEME_CHROME, ...$this->config['hide']]);
        // Printed in the same breath as the header: if this hook never runs, the theme's header is not hidden either.
        echo '<style id="kcpw-checkout-chrome">' . $css . '</style>' . HeaderMarkup::render($variant, $brandUrl, $backUrl);
    }
}
