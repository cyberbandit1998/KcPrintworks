<?php
/**
 * Runs when the plugin is deleted from the Plugins screen. Removes the plugin's own data: the stored (encrypted) Etsy
 * tokens, settings, scheduled events, and, unless KCPW_ETSY_KEEP_DATA is true in wp-config.php, the snapshot and decision
 * tables. It never touches products, orders, or any WooCommerce data.
 */

declare(strict_types=1);

if (!defined('WP_UNINSTALL_PLUGIN')) {
    exit;
}

require_once __DIR__ . '/src/Support/Autoloader.php';
\KcPrintworks\Etsy\Support\Autoloader::register(__DIR__ . '/src');

delete_option(\KcPrintworks\Etsy\Wp\WpTokenStore::OPTION);
delete_option(\KcPrintworks\Etsy\Wp\WpSettingsStore::OPTION);
delete_option(\KcPrintworks\Etsy\Wp\WpRunStateStore::OPTION);
wp_clear_scheduled_hook(\KcPrintworks\Etsy\Wp\WpScheduler::BATCH_HOOK);
wp_clear_scheduled_hook(\KcPrintworks\Etsy\Wp\WpScheduler::DAILY_HOOK);

if (!(defined('KCPW_ETSY_KEEP_DATA') && KCPW_ETSY_KEEP_DATA === true)) {
    \KcPrintworks\Etsy\Wp\Schema::uninstall();
}
