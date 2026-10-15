<?php
declare(strict_types=1);

namespace KcPrintworks\Quotes\Wp;

use KcPrintworks\Quotes\Domain\Quote;
use KcPrintworks\Quotes\Domain\Status;
use KcPrintworks\Quotes\Repo\QuoteEvent;
use KcPrintworks\Quotes\Repo\QuoteFile;
use KcPrintworks\Quotes\Repo\QuoteNote;
use KcPrintworks\Quotes\Repo\QuotePage;
use KcPrintworks\Quotes\Repo\QuoteQuery;
use KcPrintworks\Quotes\Repo\QuoteRepository;
use KcPrintworks\Quotes\Repo\RefTaken;
use KcPrintworks\Quotes\Repo\Rows;

/**
 * Quotes in the site's database through $wpdb. Every value goes through $wpdb->prepare() (never concatenated), and the SQL is plain
 * (no MySQL-only functions) so the tests can run the same statements on SQLite.
 *
 * One thing differs between engines and is handled by the callers, not hidden here: MySQL reports a changed-row count, so an UPDATE
 * that writes the values a row already has reports 0. Every swap() the plugin makes changes at least one value (a new status, a new
 * lease, a new token), so 0 reliably means "the quote had moved on".
 */
final class WpdbQuoteRepository implements QuoteRepository
{
    public function __construct(
        private readonly object $db,
        private readonly string $quotes,
        private readonly string $files,
        private readonly string $notes,
        private readonly string $events,
    ) {
    }

    public static function forSite(): self
    {
        global $wpdb;
        return new self($wpdb, Schema::quotes(), Schema::files(), Schema::notes(), Schema::events());
    }

    public function create(array $fields): Quote
    {
        $row = Rows::build(0, $fields);
        unset($row['id']);
        if (($row['ref'] ?? '') !== '' && $this->findByRef((string) $row['ref']) !== null) {
            throw new RefTaken((string) $row['ref']);
        }
        $formats = array_map(static fn (string $column): string => Rows::isText($column) ? '%s' : '%d', array_keys($row));
        if ($this->db->insert($this->quotes, $row, $formats) === false) {
            if (($row['ref'] ?? '') !== '' && $this->findByRef((string) $row['ref']) !== null) {
                throw new RefTaken((string) $row['ref']);
            }
            throw new \RuntimeException('The quote could not be saved: ' . (string) ($this->db->last_error ?? ''));
        }
        $found = $this->find((int) $this->db->insert_id);
        if ($found === null) {
            throw new \RuntimeException('The quote was saved but could not be read back.');
        }
        return $found;
    }

    public function find(int $id): ?Quote
    {
        return $this->one($this->db->prepare("SELECT * FROM {$this->quotes} WHERE id = %d", $id));
    }

    public function findByRef(string $ref): ?Quote
    {
        return $this->one($this->db->prepare("SELECT * FROM {$this->quotes} WHERE ref = %s", $ref));
    }

    public function findByOrderId(int $orderId): ?Quote
    {
        if ($orderId < 1) {
            return null;
        }
        return $this->one($this->db->prepare("SELECT * FROM {$this->quotes} WHERE order_id = %d ORDER BY id LIMIT 1", $orderId));
    }

    public function swap(int $id, array $fromStatuses, array $changes, array $guard, int $now): bool
    {
        $changes = Rows::cast($changes);
        $changes['updated_at'] = $now;
        $sets = [];
        $args = [];
        foreach ($changes as $column => $value) {
            $this->assertColumn($column);
            $sets[] = "{$column} = " . (is_int($value) ? '%d' : '%s');
            $args[] = $value;
        }
        $where = ['id = %d'];
        $args[] = $id;
        if ($fromStatuses !== []) {
            $where[] = 'status IN (' . implode(', ', array_fill(0, count($fromStatuses), '%s')) . ')';
            array_push($args, ...array_values($fromStatuses));
        }
        foreach (Rows::cast($guard) as $column => $value) {
            $this->assertColumn($column);
            $where[] = "{$column} = " . (is_int($value) ? '%d' : '%s');
            $args[] = $value;
        }
        $sql = $this->db->prepare("UPDATE {$this->quotes} SET " . implode(', ', $sets) . ' WHERE ' . implode(' AND ', $where), ...$args);
        return $this->db->query($sql) === 1;
    }

    public function search(QuoteQuery $query): QuotePage
    {
        $where = ['1 = 1'];
        $args = [];
        if ($query->status !== '') {
            $where[] = 'status = %s';
            $args[] = $query->status;
        }
        if ($query->attentionOnly) {
            $where[] = 'attention = 1';
        }
        $words = preg_split('/\s+/', trim($query->search), -1, PREG_SPLIT_NO_EMPTY) ?: [];
        foreach (array_slice($words, 0, 6) as $word) {
            $like = '%' . strtr(mb_substr($word, 0, 60), ['!' => '!!', '%' => '!%', '_' => '!_']) . '%';
            $parts = [];
            foreach (['ref', 'name', 'email', 'game', 'description', 'quote_title'] as $column) {
                $parts[] = "{$column} LIKE %s ESCAPE '!'";
                $args[] = $like;
            }
            $where[] = '(' . implode(' OR ', $parts) . ')';
        }
        $clause = implode(' AND ', $where);
        $perPage = max(1, min(200, $query->perPage));
        $page = max(1, $query->page);
        $total = (int) $this->db->get_var($this->prepared("SELECT COUNT(*) FROM {$this->quotes} WHERE {$clause}", $args));
        $rows = $this->db->get_results($this->prepared(
            "SELECT * FROM {$this->quotes} WHERE {$clause} ORDER BY created_at DESC, id DESC LIMIT %d OFFSET %d",
            [...$args, $perPage, ($page - 1) * $perPage],
        ), ARRAY_A);
        return new QuotePage(array_map(fn (array $r): Quote => $this->hydrate($r), is_array($rows) ? $rows : []), $total, $page, $perPage);
    }

    public function counts(): array
    {
        $counts = array_fill_keys(Status::all(), 0);
        $rows = $this->db->get_results("SELECT status, COUNT(*) AS n FROM {$this->quotes} GROUP BY status", ARRAY_A);
        foreach (is_array($rows) ? $rows : [] as $row) {
            $counts[(string) $row['status']] = (int) $row['n'];
        }
        return $counts;
    }

    public function countSince(int $since, string $clientHash = ''): int
    {
        if ($clientHash === '') {
            return (int) $this->db->get_var($this->db->prepare("SELECT COUNT(*) FROM {$this->quotes} WHERE created_at >= %d", $since));
        }
        return (int) $this->db->get_var($this->db->prepare("SELECT COUNT(*) FROM {$this->quotes} WHERE created_at >= %d AND client_hash = %s", $since, $clientHash));
    }

    public function findByEmail(string $email): array
    {
        $rows = $this->db->get_results($this->db->prepare("SELECT * FROM {$this->quotes} WHERE email = %s ORDER BY created_at DESC, id DESC", strtolower($email)), ARRAY_A);
        return array_map(fn (array $r): Quote => $this->hydrate($r), is_array($rows) ? $rows : []);
    }

    public function dueForExpiry(int $now, int $limit): array
    {
        $rows = $this->db->get_results($this->db->prepare(
            "SELECT * FROM {$this->quotes} WHERE (status = %s AND expires_at > 0 AND expires_at <= %d) OR (status = %s AND pay_by > 0 AND pay_by <= %d) ORDER BY id LIMIT %d",
            Status::QUOTED,
            $now,
            Status::APPROVED,
            $now,
            max(1, $limit),
        ), ARRAY_A);
        return array_map(fn (array $r): Quote => $this->hydrate($r), is_array($rows) ? $rows : []);
    }

    public function addFile(int $quoteId, string $storedName, string $displayName, string $mime, int $bytes, int $now): QuoteFile
    {
        $ok = $this->db->insert($this->files, [
            'quote_id' => $quoteId, 'stored_name' => $storedName, 'display_name' => $displayName, 'mime' => $mime, 'bytes' => $bytes, 'created_at' => $now,
        ], ['%d', '%s', '%s', '%s', '%d', '%d']);
        if ($ok === false) {
            throw new \RuntimeException('The picture record could not be saved.');
        }
        return new QuoteFile((int) $this->db->insert_id, $quoteId, $storedName, $displayName, $mime, $bytes, $now);
    }

    public function files(int $quoteId): array
    {
        $rows = $this->db->get_results($this->db->prepare("SELECT * FROM {$this->files} WHERE quote_id = %d ORDER BY id", $quoteId), ARRAY_A);
        return array_map(fn (array $r): QuoteFile => $this->fileFrom($r), is_array($rows) ? $rows : []);
    }

    public function file(int $fileId): ?QuoteFile
    {
        $row = $this->db->get_row($this->db->prepare("SELECT * FROM {$this->files} WHERE id = %d", $fileId), ARRAY_A);
        return is_array($row) ? $this->fileFrom($row) : null;
    }

    public function removeFiles(int $quoteId): array
    {
        $gone = $this->files($quoteId);
        $this->db->query($this->db->prepare("DELETE FROM {$this->files} WHERE quote_id = %d", $quoteId));
        return $gone;
    }

    public function addNote(int $quoteId, int $userId, string $author, string $note, int $now): QuoteNote
    {
        $ok = $this->db->insert($this->notes, [
            'quote_id' => $quoteId, 'user_id' => $userId, 'author' => $author, 'note' => $note, 'created_at' => $now,
        ], ['%d', '%d', '%s', '%s', '%d']);
        if ($ok === false) {
            throw new \RuntimeException('The note could not be saved.');
        }
        return new QuoteNote((int) $this->db->insert_id, $quoteId, $userId, $author, $note, $now);
    }

    public function notes(int $quoteId): array
    {
        $rows = $this->db->get_results($this->db->prepare("SELECT * FROM {$this->notes} WHERE quote_id = %d ORDER BY id", $quoteId), ARRAY_A);
        return array_map(static fn (array $r): QuoteNote => new QuoteNote((int) $r['id'], (int) $r['quote_id'], (int) $r['user_id'], (string) $r['author'], (string) $r['note'], (int) $r['created_at']), is_array($rows) ? $rows : []);
    }

    public function eraseNotes(int $quoteId): int
    {
        $n = $this->db->query($this->db->prepare("UPDATE {$this->notes} SET note = %s WHERE quote_id = %d", '[erased]', $quoteId));
        return is_int($n) ? $n : 0;
    }

    public function addEvent(int $quoteId, string $actor, string $kind, string $detail, int $now): void
    {
        $this->db->insert($this->events, ['quote_id' => $quoteId, 'at' => $now, 'actor' => $actor, 'kind' => $kind, 'detail' => $detail], ['%d', '%d', '%s', '%s', '%s']);
    }

    public function events(int $quoteId): array
    {
        $rows = $this->db->get_results($this->db->prepare("SELECT * FROM {$this->events} WHERE quote_id = %d ORDER BY id", $quoteId), ARRAY_A);
        return array_map(static fn (array $r): QuoteEvent => new QuoteEvent((int) $r['id'], (int) $r['quote_id'], (int) $r['at'], (string) $r['actor'], (string) $r['kind'], (string) $r['detail']), is_array($rows) ? $rows : []);
    }

    private function one(string $sql): ?Quote
    {
        $row = $this->db->get_row($sql, ARRAY_A);
        return is_array($row) ? $this->hydrate($row) : null;
    }

    /** @param array<string,mixed> $row */
    private function hydrate(array $row): Quote
    {
        return Quote::fromRow(Rows::cast($row));
    }

    /** @param array<string,mixed> $row */
    private function fileFrom(array $row): QuoteFile
    {
        return new QuoteFile((int) $row['id'], (int) $row['quote_id'], (string) $row['stored_name'], (string) $row['display_name'], (string) $row['mime'], (int) $row['bytes'], (int) $row['created_at']);
    }

    /** @param list<mixed> $args */
    private function prepared(string $sql, array $args): string
    {
        return $args === [] ? $sql : $this->db->prepare($sql, ...$args);
    }

    /** Column names come from our own code, but an unknown one is a bug: refuse rather than build SQL from it. */
    private function assertColumn(string $column): void
    {
        if (!array_key_exists($column, Rows::DEFAULTS)) {
            throw new \InvalidArgumentException('Unknown quote column: ' . $column);
        }
    }
}
