<?php
declare(strict_types=1);

namespace KcPrintworks\Quotes\Wp;

/**
 * The plugin's four tables (quotes, pictures, private notes, history). Nothing in WooCommerce's own tables is created or altered, and
 * orders are linked only through order meta and the quote's `order_id`, so it works the same with HPOS (custom order tables) on or off.
 */
final class Schema
{
    public const VERSION = '1';
    public const OPTION = 'kcpw_quotes_schema_version';

    public static function quotes(): string
    {
        global $wpdb;
        return $wpdb->prefix . 'kcpw_quotes';
    }

    public static function files(): string
    {
        global $wpdb;
        return $wpdb->prefix . 'kcpw_quote_files';
    }

    public static function notes(): string
    {
        global $wpdb;
        return $wpdb->prefix . 'kcpw_quote_notes';
    }

    public static function events(): string
    {
        global $wpdb;
        return $wpdb->prefix . 'kcpw_quote_events';
    }

    /**
     * The CREATE TABLE statements, in the layout WordPress's dbDelta() requires (one column per line, two spaces after PRIMARY KEY).
     *
     * @return list<string>
     */
    public static function statements(string $charset, string $prefix): array
    {
        $q = $prefix . 'kcpw_quotes';
        $f = $prefix . 'kcpw_quote_files';
        $n = $prefix . 'kcpw_quote_notes';
        $e = $prefix . 'kcpw_quote_events';
        return [
            "CREATE TABLE {$q} (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  ref VARCHAR(20) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'new',
  created_at BIGINT UNSIGNED NOT NULL DEFAULT 0,
  updated_at BIGINT UNSIGNED NOT NULL DEFAULT 0,
  name VARCHAR(200) NOT NULL DEFAULT '',
  email VARCHAR(190) NOT NULL DEFAULT '',
  project_type VARCHAR(40) NOT NULL DEFAULT '',
  game VARCHAR(500) NOT NULL DEFAULT '',
  description LONGTEXT NOT NULL,
  dimensions VARCHAR(800) NOT NULL DEFAULT '',
  quantity INT UNSIGNED NOT NULL DEFAULT 1,
  colors VARCHAR(800) NOT NULL DEFAULT '',
  deadline VARCHAR(10) NOT NULL DEFAULT '',
  ship_to VARCHAR(500) NOT NULL DEFAULT '',
  client_hash CHAR(64) NOT NULL DEFAULT '',
  quote_title VARCHAR(500) NOT NULL DEFAULT '',
  quote_details LONGTEXT NOT NULL,
  item_cents BIGINT UNSIGNED NOT NULL DEFAULT 0,
  ship_cents BIGINT UNSIGNED NOT NULL DEFAULT 0,
  currency VARCHAR(3) NOT NULL DEFAULT '',
  taxable TINYINT UNSIGNED NOT NULL DEFAULT 0,
  revision INT UNSIGNED NOT NULL DEFAULT 0,
  quoted_at BIGINT UNSIGNED NOT NULL DEFAULT 0,
  expires_at BIGINT UNSIGNED NOT NULL DEFAULT 0,
  approved_at BIGINT UNSIGNED NOT NULL DEFAULT 0,
  pay_by BIGINT UNSIGNED NOT NULL DEFAULT 0,
  paid_at BIGINT UNSIGNED NOT NULL DEFAULT 0,
  token_hash CHAR(64) NOT NULL DEFAULT '',
  order_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
  order_fp CHAR(64) NOT NULL DEFAULT '',
  order_lease VARCHAR(40) NOT NULL DEFAULT '',
  order_lease_at BIGINT UNSIGNED NOT NULL DEFAULT 0,
  address TEXT NOT NULL,
  phone VARCHAR(60) NOT NULL DEFAULT '',
  attention TINYINT UNSIGNED NOT NULL DEFAULT 0,
  attention_reason VARCHAR(500) NOT NULL DEFAULT '',
  erased TINYINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY  (id),
  UNIQUE KEY ref (ref),
  KEY status_created (status,created_at),
  KEY email (email),
  KEY created_at (created_at),
  KEY client_hash (client_hash),
  KEY order_id (order_id)
) {$charset};",
            "CREATE TABLE {$f} (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  quote_id BIGINT UNSIGNED NOT NULL,
  stored_name CHAR(40) NOT NULL,
  display_name VARCHAR(255) NOT NULL DEFAULT '',
  mime VARCHAR(40) NOT NULL DEFAULT '',
  bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
  created_at BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY  (id),
  UNIQUE KEY stored_name (stored_name),
  KEY quote_id (quote_id)
) {$charset};",
            "CREATE TABLE {$n} (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  quote_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
  author VARCHAR(255) NOT NULL DEFAULT '',
  note TEXT NOT NULL,
  created_at BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY  (id),
  KEY quote_id (quote_id)
) {$charset};",
            "CREATE TABLE {$e} (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  quote_id BIGINT UNSIGNED NOT NULL,
  at BIGINT UNSIGNED NOT NULL DEFAULT 0,
  actor VARCHAR(60) NOT NULL DEFAULT '',
  kind VARCHAR(40) NOT NULL DEFAULT '',
  detail TEXT NOT NULL,
  PRIMARY KEY  (id),
  KEY quote_id (quote_id)
) {$charset};",
        ];
    }

    public static function install(): void
    {
        global $wpdb;
        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        foreach (self::statements($wpdb->get_charset_collate(), $wpdb->prefix) as $statement) {
            dbDelta($statement);
        }
        update_option(self::OPTION, self::VERSION);
    }

    /** Only for the explicit "delete everything" choice at uninstall. */
    public static function drop(): void
    {
        global $wpdb;
        foreach ([self::events(), self::notes(), self::files(), self::quotes()] as $table) {
            $wpdb->query("DROP TABLE IF EXISTS {$table}");
        }
        delete_option(self::OPTION);
    }
}
