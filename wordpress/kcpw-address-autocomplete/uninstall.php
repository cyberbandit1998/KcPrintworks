<?php
/**
 * Runs when the plugin is deleted from the Plugins screen: removes everything it stored (settings including any saved Google or server
 * key, the form list, the usage counters, and the short-lived caches and rate-limit markers). Nothing else on the site is touched.
 */

if (!defined('WP_UNINSTALL_PLUGIN')) {
    exit;
}

foreach (['kcpw_aa_settings', 'kcpw_aa_forms', 'kcpw_aa_usage', 'kcpw_aa_conflicts'] as $option) {
    delete_option($option);
}

// The temporary markers (rate limits, remembered address-check answers, the once-an-hour webhook guard, the order-counted markers) would
// expire by themselves; this just does not leave them waiting.
global $wpdb;
if (isset($wpdb) && is_object($wpdb)) {
    $wpdb->query(
        $wpdb->prepare(
            "DELETE FROM {$wpdb->options} WHERE option_name LIKE %s OR option_name LIKE %s",
            $wpdb->esc_like('_transient_kcpw_aa_') . '%',
            $wpdb->esc_like('_transient_timeout_kcpw_aa_') . '%',
        ),
    );
}
