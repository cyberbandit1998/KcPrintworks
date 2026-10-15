<?php
/**
 * Runs when the plugin is deleted from the Plugins screen. By default it removes NOTHING that holds customer or money records: the quote
 * tables, the pictures and the WooCommerce orders made for quotes all stay, because they are business records and a reinstall should find
 * them again. Only the scheduled job is removed.
 *
 * To delete the quote tables too, add this line to wp-config.php BEFORE deleting the plugin:
 *     define('KCPW_QUOTES_DELETE_DATA_ON_UNINSTALL', true);
 * (Pictures in the pictures folder are not deleted automatically: remove that folder yourself if you want them gone.)
 */

declare(strict_types=1);

if (!defined('WP_UNINSTALL_PLUGIN')) {
    exit;
}

require_once __DIR__ . '/src/Support/Autoloader.php';
\KcPrintworks\Quotes\Support\Autoloader::register(__DIR__ . '/src');
wp_clear_scheduled_hook(\KcPrintworks\Quotes\Wp\Plugin::CRON_HOOK);
if (defined('KCPW_QUOTES_DELETE_DATA_ON_UNINSTALL') && KCPW_QUOTES_DELETE_DATA_ON_UNINSTALL === true) {
    \KcPrintworks\Quotes\Wp\Schema::drop();
}
