<?php
/**
 * Plugin Name:       KCPrintWorks Etsy Sync (read-only preview)
 * Description:       Connects the KCPrintWorks Etsy shop (read-only Seller App access), downloads the listings, and shows which WooCommerce products they match and what a synchronization would change. In this version it cannot create, change, or delete any WooCommerce product, price, stock level, or order.
 * Version:           0.1.0
 * Requires at least: 6.4
 * Requires PHP:      8.1
 * Requires Plugins:  woocommerce
 * Author:            KCPrintWorks
 * License:           GPL-2.0-or-later
 * Text Domain:       kcpw-etsy
 */

declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

define('KCPW_ETSY_VERSION', '0.1.0');
define('KCPW_ETSY_FILE', __FILE__);

if (PHP_VERSION_ID < 80100) {
    add_action('admin_notices', static function (): void {
        echo '<div class="notice notice-error"><p>KCPrintWorks Etsy Sync needs PHP 8.1 or newer. This server runs PHP ' . esc_html(PHP_VERSION) . '. The plugin is switched off until PHP is updated.</p></div>';
    });
    return;
}

require_once __DIR__ . '/src/Support/Autoloader.php';
\KcPrintworks\Etsy\Support\Autoloader::register(__DIR__ . '/src');

register_activation_hook(__FILE__, [\KcPrintworks\Etsy\Wp\Schema::class, 'install']);
register_deactivation_hook(__FILE__, static function (): void {
    wp_clear_scheduled_hook(\KcPrintworks\Etsy\Wp\WpScheduler::BATCH_HOOK);
    wp_clear_scheduled_hook(\KcPrintworks\Etsy\Wp\WpScheduler::DAILY_HOOK);
});

add_action('plugins_loaded', static function (): void {
    if (!class_exists('WooCommerce')) {
        add_action('admin_notices', static function (): void {
            echo '<div class="notice notice-warning"><p>KCPrintWorks Etsy Sync needs WooCommerce to be active.</p></div>';
        });
        return;
    }
    // Create or upgrade the plugin's own tables if the schema version changed (never touches WooCommerce tables).
    if (get_option(\KcPrintworks\Etsy\Wp\Schema::OPTION) !== \KcPrintworks\Etsy\Wp\Schema::VERSION) {
        \KcPrintworks\Etsy\Wp\Schema::install();
    }
    \KcPrintworks\Etsy\Wp\Plugin::boot();
});
