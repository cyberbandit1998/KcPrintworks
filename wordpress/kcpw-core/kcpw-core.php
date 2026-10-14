<?php
/**
 * Plugin Name:       KCPrintWorks Core (checkout link and personalization)
 * Description:       Lets the KCPrintWorks storefront hand a validated cart to WooCommerce checkout, saves each customer's personalization choices on the order item, and receives customer reviews from the storefront as pending reviews that wait for your approval. Works with whatever tool fills WooCommerce with products. It never creates, edits, or deletes products, and it contains no payment code (the official Stripe plugin takes payments).
 * Version:           0.2.1
 * Requires at least: 6.4
 * Requires PHP:      8.1
 * Requires Plugins:  woocommerce
 * Author:            KCPrintWorks
 * License:           GPL-2.0-or-later
 * Text Domain:       kcpw-core
 */

declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

define('KCPW_CORE_VERSION', '0.2.1');
define('KCPW_CORE_FILE', __FILE__);

if (PHP_VERSION_ID < 80100 || !function_exists('mb_strlen')) {
    add_action('admin_notices', static function (): void {
        echo '<div class="notice notice-error"><p>KCPrintWorks Core needs PHP 8.1 or newer with the mbstring extension. It is switched off until the server meets that.</p></div>';
    });
    return;
}

require_once __DIR__ . '/src/Support/Autoloader.php';
\KcPrintworks\Core\Support\Autoloader::register(__DIR__ . '/src');

register_activation_hook(__FILE__, static function (): void {
    \KcPrintworks\Core\Wp\Schema::install();
    if (!wp_next_scheduled(\KcPrintworks\Core\Wp\Plugin::PURGE_HOOK)) {
        wp_schedule_event(time() + 3600, 'daily', \KcPrintworks\Core\Wp\Plugin::PURGE_HOOK);
    }
});
register_deactivation_hook(__FILE__, static function (): void {
    wp_clear_scheduled_hook(\KcPrintworks\Core\Wp\Plugin::PURGE_HOOK);
});

// This plugin does not touch order storage tables or the checkout form itself, so it is compatible with both.
add_action('before_woocommerce_init', static function (): void {
    if (class_exists(\Automattic\WooCommerce\Utilities\FeaturesUtil::class)) {
        \Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility('custom_order_tables', __FILE__, true);
        \Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility('cart_checkout_blocks', __FILE__, true);
    }
});

add_action('plugins_loaded', static function (): void {
    if (!class_exists('WooCommerce')) {
        add_action('admin_notices', static function (): void {
            echo '<div class="notice notice-warning"><p>KCPrintWorks Core needs WooCommerce to be active.</p></div>';
        });
        return;
    }
    if (get_option(\KcPrintworks\Core\Wp\Schema::OPTION) !== \KcPrintworks\Core\Wp\Schema::VERSION) {
        \KcPrintworks\Core\Wp\Schema::install();
    }
    \KcPrintworks\Core\Wp\Plugin::boot(KCPW_CORE_VERSION);
});
