<?php
/**
 * Plugin Name:       KCPrintWorks Custom Quotes
 * Description:       Custom quote requests from the storefront: a private dashboard to review them, price them and email a quote, a secure expiring link for the customer to approve it, and a WooCommerce order for exactly the approved amount that is paid through your normal checkout (Stripe). It never changes normal checkout, products, shipping zones or payment settings, and it contains no payment code.
 * Version:           0.1.0
 * Requires at least: 6.4
 * Requires PHP:      8.1
 * Requires Plugins:  woocommerce
 * Author:            KCPrintWorks
 * License:           GPL-2.0-or-later
 * Text Domain:       kcpw-quotes
 */

declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

define('KCPW_QUOTES_VERSION', '0.1.0');
define('KCPW_QUOTES_FILE', __FILE__);

if (PHP_VERSION_ID < 80100 || !function_exists('mb_strlen')) {
    add_action('admin_notices', static function (): void {
        echo '<div class="notice notice-error"><p>KCPrintWorks Custom Quotes needs PHP 8.1 or newer with the mbstring extension. It is switched off until the server meets that.</p></div>';
    });
    return;
}

require_once __DIR__ . '/src/Support/Autoloader.php';
\KcPrintworks\Quotes\Support\Autoloader::register(__DIR__ . '/src');

register_activation_hook(__FILE__, static function (): void {
    \KcPrintworks\Quotes\Wp\Schema::install();
    if (!wp_next_scheduled(\KcPrintworks\Quotes\Wp\Plugin::CRON_HOOK)) {
        wp_schedule_event(time() + 600, 'hourly', \KcPrintworks\Quotes\Wp\Plugin::CRON_HOOK);
    }
    \KcPrintworks\Quotes\Wp\WpFileStore::forSite()->prepare();
});
register_deactivation_hook(__FILE__, static function (): void {
    wp_clear_scheduled_hook(\KcPrintworks\Quotes\Wp\Plugin::CRON_HOOK);
});

// Orders are made and read only through WooCommerce's own order objects, so this works with custom order tables (HPOS) on or off.
add_action('before_woocommerce_init', static function (): void {
    if (class_exists(\Automattic\WooCommerce\Utilities\FeaturesUtil::class)) {
        \Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility('custom_order_tables', __FILE__, true);
        \Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility('cart_checkout_blocks', __FILE__, true);
    }
});

add_action('plugins_loaded', static function (): void {
    if (!class_exists('WooCommerce')) {
        add_action('admin_notices', static function (): void {
            echo '<div class="notice notice-warning"><p>KCPrintWorks Custom Quotes needs WooCommerce to be active.</p></div>';
        });
        return;
    }
    if (get_option(\KcPrintworks\Quotes\Wp\Schema::OPTION) !== \KcPrintworks\Quotes\Wp\Schema::VERSION) {
        \KcPrintworks\Quotes\Wp\Schema::install();
    }
    if (!wp_next_scheduled(\KcPrintworks\Quotes\Wp\Plugin::CRON_HOOK)) {
        wp_schedule_event(time() + 600, 'hourly', \KcPrintworks\Quotes\Wp\Plugin::CRON_HOOK);
    }
    \KcPrintworks\Quotes\Wp\Plugin::boot(KCPW_QUOTES_VERSION);
});
