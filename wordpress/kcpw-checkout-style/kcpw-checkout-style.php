<?php
/**
 * Plugin Name:       KCPrintWorks Checkout Style
 * Description:       Makes the WooCommerce checkout page match the KCPrintWorks storefront: a compact branded header, the storefront's colors, type and buttons, and the old store-wide promo notice removed. Styling only: it changes nothing about the cart, the checkout form, payments (Stripe, PayPal), shipping, tax, orders or personalization, and it loads no script and nothing from other sites.
 * Version:           0.1.0
 * Requires at least: 6.4
 * Requires PHP:      8.1
 * Author:            KCPrintWorks
 * License:           GPL-2.0-or-later
 * Text Domain:       kcpw-checkout-style
 */

declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

define('KCPW_CHECKOUT_STYLE_VERSION', '0.1.0');
define('KCPW_CHECKOUT_STYLE_FILE', __FILE__);

if (PHP_VERSION_ID < 80100) {
    return;
}

require_once __DIR__ . '/src/Settings.php';
require_once __DIR__ . '/src/HeaderMarkup.php';
require_once __DIR__ . '/src/Plugin.php';

// Styling only: compatible with the Cart and Checkout blocks and with high-performance order storage.
add_action('before_woocommerce_init', static function (): void {
    if (class_exists(\Automattic\WooCommerce\Utilities\FeaturesUtil::class)) {
        \Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility('custom_order_tables', __FILE__, true);
        \Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility('cart_checkout_blocks', __FILE__, true);
    }
});

add_action('plugins_loaded', static function (): void {
    (new \KcPrintworks\CheckoutStyle\Plugin(
        __FILE__,
        KCPW_CHECKOUT_STYLE_VERSION,
        [
            'mode' => \KcPrintworks\CheckoutStyle\Settings::mode(defined('KCPW_CHECKOUT_STYLE') ? KCPW_CHECKOUT_STYLE : null),
            'pageId' => \KcPrintworks\CheckoutStyle\Settings::pageId(defined('KCPW_CHECKOUT_STYLE_PAGE_ID') ? KCPW_CHECKOUT_STYLE_PAGE_ID : null),
            'storefront' => \KcPrintworks\CheckoutStyle\Settings::storefrontOrigin(defined('KCPW_STOREFRONT_URL') ? KCPW_STOREFRONT_URL : null),
            'hide' => \KcPrintworks\CheckoutStyle\Settings::hideSelectors(defined('KCPW_CHECKOUT_STYLE_HIDE') ? KCPW_CHECKOUT_STYLE_HIDE : null),
        ],
    ))->register();
});
