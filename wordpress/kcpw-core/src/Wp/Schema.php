<?php
declare(strict_types=1);

namespace KcPrintworks\Core\Wp;

/** The plugin's one table: pending cart handoffs. Nothing in WooCommerce's own tables is created or altered. */
final class Schema
{
    public const VERSION = '1';
    public const OPTION = 'kcpw_core_schema_version';

    public static function table(): string
    {
        global $wpdb;
        return $wpdb->prefix . 'kcpw_handoff';
    }

    public static function install(): void
    {
        global $wpdb;
        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        $table = self::table();
        $charset = $wpdb->get_charset_collate();
        dbDelta("CREATE TABLE {$table} (
  token_hash CHAR(64) NOT NULL,
  payload LONGTEXT NOT NULL,
  expires_at BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY  (token_hash),
  KEY expires_at (expires_at)
) {$charset};");
        update_option(self::OPTION, self::VERSION);
    }

    public static function drop(): void
    {
        global $wpdb;
        $table = self::table();
        $wpdb->query("DROP TABLE IF EXISTS {$table}");
        delete_option(self::OPTION);
    }
}
