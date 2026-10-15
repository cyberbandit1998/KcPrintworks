<?php
declare(strict_types=1);

namespace KcPrintworks\Quotes\Tests;

/**
 * A stand-in for WordPress's $wpdb on SQLite, so the repository's real SQL statements run in the tests. It implements only what the
 * plugin calls (prepare, query, get_row, get_results, get_var, insert, get_charset_collate), with the same observable behavior:
 * prepare() substitutes %d and %s (and %%), insert() returns false on an error, query() returns the number of rows changed.
 * It is NOT MySQL: the staging checklist is what proves the SQL on a real database.
 */
final class FakeWpdb
{
    public string $prefix = 'wp_';
    public int $insert_id = 0;
    public string $last_error = '';
    /** @var list<string> every statement that ran, for tests that look at the SQL */
    public array $log = [];
    private \PDO $pdo;

    public function __construct()
    {
        $this->pdo = new \PDO('sqlite::memory:');
        $this->pdo->setAttribute(\PDO::ATTR_ERRMODE, \PDO::ERRMODE_EXCEPTION);
        foreach (self::ddl($this->prefix) as $statement) {
            $this->pdo->exec($statement);
        }
    }

    /** SQLite versions of the four tables. A test compares their column names with Schema::statements() so they cannot drift. @return list<string> */
    public static function ddl(string $prefix): array
    {
        $text = ['ref', 'status', 'name', 'email', 'project_type', 'game', 'description', 'dimensions', 'colors', 'deadline', 'ship_to', 'client_hash', 'quote_title', 'quote_details', 'currency', 'token_hash', 'order_fp', 'order_lease', 'address', 'phone', 'attention_reason'];
        $columns = [];
        foreach (\KcPrintworks\Quotes\Repo\Rows::DEFAULTS as $column => $default) {
            $columns[] = $column . ' ' . (in_array($column, $text, true) ? "TEXT NOT NULL DEFAULT ''" : 'INTEGER NOT NULL DEFAULT 0');
        }
        return [
            "CREATE TABLE {$prefix}kcpw_quotes (id INTEGER PRIMARY KEY AUTOINCREMENT, " . implode(', ', $columns) . ', UNIQUE (ref))',
            "CREATE TABLE {$prefix}kcpw_quote_files (id INTEGER PRIMARY KEY AUTOINCREMENT, quote_id INTEGER NOT NULL, stored_name TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL DEFAULT '', mime TEXT NOT NULL DEFAULT '', bytes INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL DEFAULT 0)",
            "CREATE TABLE {$prefix}kcpw_quote_notes (id INTEGER PRIMARY KEY AUTOINCREMENT, quote_id INTEGER NOT NULL, user_id INTEGER NOT NULL DEFAULT 0, author TEXT NOT NULL DEFAULT '', note TEXT NOT NULL, created_at INTEGER NOT NULL DEFAULT 0)",
            "CREATE TABLE {$prefix}kcpw_quote_events (id INTEGER PRIMARY KEY AUTOINCREMENT, quote_id INTEGER NOT NULL, at INTEGER NOT NULL DEFAULT 0, actor TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL DEFAULT '', detail TEXT NOT NULL)",
        ];
    }

    public function get_charset_collate(): string
    {
        return 'DEFAULT CHARACTER SET utf8mb4';
    }

    public function prepare(string $query, mixed ...$args): string
    {
        if (count($args) === 1 && is_array($args[0])) {
            $args = $args[0];
        }
        $i = 0;
        $out = preg_replace_callback('/%(%|d|s)/', function (array $m) use (&$i, $args): string {
            if ($m[1] === '%') {
                return '%';
            }
            if (!array_key_exists($i, $args)) {
                throw new \LogicException('prepare(): too few arguments for ' . $m[0]);
            }
            $value = $args[$i++];
            return $m[1] === 'd' ? (string) (int) $value : "'" . str_replace("'", "''", (string) $value) . "'";
        }, $query);
        if ($i !== count($args)) {
            throw new \LogicException('prepare(): ' . count($args) . ' arguments for ' . $i . ' placeholders');
        }
        return (string) $out;
    }

    public function query(string $sql): int|bool
    {
        $this->log[] = $sql;
        try {
            $n = $this->pdo->exec($sql);
        } catch (\PDOException $e) {
            $this->last_error = $e->getMessage();
            return false;
        }
        return $n === false ? false : $n;
    }

    /** @return array<string,mixed>|null */
    public function get_row(string $sql, string $output = 'OBJECT'): ?array
    {
        $rows = $this->get_results($sql, $output);
        return $rows[0] ?? null;
    }

    /** @return list<array<string,mixed>> */
    public function get_results(string $sql, string $output = 'OBJECT'): array
    {
        $this->log[] = $sql;
        if (preg_match("/^SHOW TABLES LIKE '(.+)'$/s", $sql, $m) === 1) {
            $sql = "SELECT name FROM sqlite_master WHERE type = 'table' AND name = '" . $m[1] . "'";
        }
        $statement = $this->pdo->query($sql);
        $rows = $statement === false ? [] : $statement->fetchAll(\PDO::FETCH_ASSOC);
        // MySQL (through mysqli) hands every value back as a string; so does this.
        return array_map(static fn (array $r): array => array_map(static fn ($v) => $v === null ? null : (string) $v, $r), $rows);
    }

    public function get_var(string $sql): mixed
    {
        $row = $this->get_results($sql, 'ARRAY_N')[0] ?? null;
        return $row === null ? null : array_values($row)[0];
    }

    /**
     * @param array<string,mixed> $data
     * @param list<string> $format
     */
    public function insert(string $table, array $data, array $format = []): int|false
    {
        $columns = array_keys($data);
        $placeholders = implode(', ', array_fill(0, count($columns), '?'));
        $sql = "INSERT INTO {$table} (" . implode(', ', $columns) . ") VALUES ({$placeholders})";
        $this->log[] = $sql;
        try {
            $statement = $this->pdo->prepare($sql);
            $statement->execute(array_values($data));
        } catch (\PDOException $e) {
            $this->last_error = $e->getMessage();
            return false;
        }
        $this->insert_id = (int) $this->pdo->lastInsertId();
        return 1;
    }
}
