<?php
/**
 * Runs when the plugin is deleted from the Plugins screen: removes everything it stored (settings including any saved Google key,
 * the form list and the usage counters). Nothing else on the site is touched.
 */

if (!defined('WP_UNINSTALL_PLUGIN')) {
    exit;
}

foreach (['kcpw_aa_settings', 'kcpw_aa_forms', 'kcpw_aa_usage', 'kcpw_aa_conflicts'] as $option) {
    delete_option($option);
}
