<?php
/**
 * Runs when the plugin is deleted from the Plugins screen. Removes only what this plugin created: its handoff table.
 * Product personalization setups (_kcpw_option_schema), the choices saved on past orders, and the reviews customers wrote
 * (WordPress comments) are KEPT on purpose, because orders and reviews must stay readable and a reinstall should find the setups again.
 * The short-lived review-flood counters (transients) expire by themselves.
 */

declare(strict_types=1);

if (!defined('WP_UNINSTALL_PLUGIN')) {
    exit;
}

require_once __DIR__ . '/src/Support/Autoloader.php';
\KcPrintworks\Core\Support\Autoloader::register(__DIR__ . '/src');
\KcPrintworks\Core\Wp\Schema::drop();
wp_clear_scheduled_hook(\KcPrintworks\Core\Wp\Plugin::PURGE_HOOK);
