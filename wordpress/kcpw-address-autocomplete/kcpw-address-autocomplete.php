<?php
/**
 * Plugin Name:       KCPrintWorks Address Autocomplete
 * Description:       Address suggestions from Google Places for the WooCommerce Checkout Block, the classic checkout and any other form, filling street, city, state, postal code and country correctly (React-safe, so shipping rates and Stripe get the right address). Starts in an administrators-only preview, loads nothing until a visitor clicks into an address field, and every extra feature is optional and off by default.
 * Version:           0.1.0
 * Requires at least: 6.4
 * Requires PHP:      8.1
 * Author:            KCPrintWorks
 * License:           GPL-2.0-or-later
 * Text Domain:       kcpw-address-autocomplete
 */

declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

define('KCPW_AA_VERSION', '0.1.0');
define('KCPW_AA_FILE', __FILE__);

if (PHP_VERSION_ID < 80100) {
    return;
}

foreach (['Settings', 'Presets', 'FormConfig', 'PageMatcher', 'Usage', 'RateLimiter', 'Frontend', 'Rest', 'Admin', 'Plugin'] as $class) {
    require_once __DIR__ . '/src/' . $class . '.php';
}

// Only adds script to the front end and settings screens: compatible with the Cart and Checkout blocks and with order storage tables.
add_action('before_woocommerce_init', static function (): void {
    if (class_exists(\Automattic\WooCommerce\Utilities\FeaturesUtil::class)) {
        \Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility('custom_order_tables', __FILE__, true);
        \Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility('cart_checkout_blocks', __FILE__, true);
    }
});

add_action('plugins_loaded', static function (): void {
    \KcPrintworks\AddressAutocomplete\Plugin::boot(__FILE__, KCPW_AA_VERSION);
});
