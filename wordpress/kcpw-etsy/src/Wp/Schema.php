<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Wp;

/**
 * The plugin's own tables. Every database write in this plugin goes through a table named here (a safety test checks it).
 * They hold the Etsy snapshot and the owner's decisions; nothing here is a WooCommerce table.
 */
final class Schema
{
    public const VERSION = '1';
    public const OPTION = 'kcpw_etsy_schema_version';

    public static function table(string $name): string
    {
        global $wpdb;
        return $wpdb->prefix . 'kcpw_etsy_' . $name;
    }

    public static function install(): void
    {
        global $wpdb;
        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        $charset = $wpdb->get_charset_collate();
        $snapshot = self::table('snapshot');
        $decision = self::table('decision');
        \dbDelta("CREATE TABLE {$snapshot} (
            listing_id BIGINT UNSIGNED NOT NULL,
            listing LONGTEXT NOT NULL,
            inventory LONGTEXT NULL,
            images LONGTEXT NULL,
            etsy_updated BIGINT UNSIGNED NOT NULL DEFAULT 0,
            fetched_at DATETIME NOT NULL,
            PRIMARY KEY  (listing_id)
        ) {$charset};");
        \dbDelta("CREATE TABLE {$decision} (
            etsy_listing_id BIGINT UNSIGNED NOT NULL,
            type VARCHAR(20) NOT NULL,
            woo_product_id BIGINT UNSIGNED NULL,
            decided_by VARCHAR(190) NOT NULL DEFAULT '',
            decided_at DATETIME NOT NULL,
            note TEXT NULL,
            PRIMARY KEY  (etsy_listing_id)
        ) {$charset};");
        \update_option(self::OPTION, self::VERSION, false);
    }

    public static function uninstall(): void
    {
        global $wpdb;
        $wpdb->query('DROP TABLE IF EXISTS ' . self::table('snapshot'));
        $wpdb->query('DROP TABLE IF EXISTS ' . self::table('decision'));
        \delete_option(self::OPTION);
    }
}
