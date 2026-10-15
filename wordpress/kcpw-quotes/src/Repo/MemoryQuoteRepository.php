<?php
declare(strict_types=1);

namespace KcPrintworks\Quotes\Repo;

use KcPrintworks\Quotes\Domain\Quote;
use KcPrintworks\Quotes\Domain\Status;

/** Quotes kept in PHP arrays: the workflow tests run against this, and one contract test proves it behaves like the database store. */
final class MemoryQuoteRepository implements QuoteRepository
{
    /** @var array<int,array<string,mixed>> */
    private array $rows = [];
    /** @var array<int,QuoteFile> */
    private array $files = [];
    /** @var array<int,QuoteNote> */
    private array $notes = [];
    /** @var list<QuoteEvent> */
    private array $events = [];
    private int $nextId = 1;
    private int $nextChildId = 1;

    public function create(array $fields): Quote
    {
        $ref = (string) ($fields['ref'] ?? '');
        foreach ($this->rows as $row) {
            if ($row['ref'] === $ref) {
                throw new RefTaken($ref);
            }
        }
        $id = $this->nextId++;
        $this->rows[$id] = Rows::build($id, $fields);
        return Quote::fromRow($this->rows[$id]);
    }

    public function find(int $id): ?Quote
    {
        return isset($this->rows[$id]) ? Quote::fromRow($this->rows[$id]) : null;
    }

    public function findByRef(string $ref): ?Quote
    {
        foreach ($this->rows as $row) {
            if ($row['ref'] === $ref) {
                return Quote::fromRow($row);
            }
        }
        return null;
    }

    public function findByOrderId(int $orderId): ?Quote
    {
        if ($orderId < 1) {
            return null;
        }
        foreach ($this->rows as $row) {
            if ($row['order_id'] === $orderId) {
                return Quote::fromRow($row);
            }
        }
        return null;
    }

    public function swap(int $id, array $fromStatuses, array $changes, array $guard, int $now): bool
    {
        $row = $this->rows[$id] ?? null;
        if ($row === null) {
            return false;
        }
        if ($fromStatuses !== [] && !in_array($row['status'], $fromStatuses, true)) {
            return false;
        }
        foreach (Rows::cast($guard) as $column => $value) {
            if (($row[$column] ?? null) !== $value) {
                return false;
            }
        }
        if (isset($changes['ref'])) {
            foreach ($this->rows as $other) {
                if ($other['id'] !== $id && $other['ref'] === $changes['ref']) {
                    return false;
                }
            }
        }
        $this->rows[$id] = Rows::cast($changes) + ['updated_at' => $now] + $row;
        $this->rows[$id]['updated_at'] = $now;
        return true;
    }

    public function search(QuoteQuery $query): QuotePage
    {
        $words = preg_split('/\s+/', trim($query->search), -1, PREG_SPLIT_NO_EMPTY) ?: [];
        $matches = [];
        foreach ($this->rows as $row) {
            if ($query->status !== '' && $row['status'] !== $query->status) {
                continue;
            }
            if ($query->attentionOnly && $row['attention'] !== 1) {
                continue;
            }
            $haystack = strtolower(implode("\n", [$row['ref'], $row['name'], $row['email'], $row['game'], $row['description'], $row['quote_title']]));
            foreach ($words as $word) {
                if (!str_contains($haystack, strtolower($word))) {
                    continue 2;
                }
            }
            $matches[] = $row;
        }
        usort($matches, static fn (array $a, array $b): int => [$b['created_at'], $b['id']] <=> [$a['created_at'], $a['id']]);
        $perPage = max(1, $query->perPage);
        $page = max(1, $query->page);
        $slice = array_slice($matches, ($page - 1) * $perPage, $perPage);
        return new QuotePage(array_map(static fn (array $r): Quote => Quote::fromRow($r), $slice), count($matches), $page, $perPage);
    }

    public function counts(): array
    {
        $counts = array_fill_keys(Status::all(), 0);
        foreach ($this->rows as $row) {
            $counts[$row['status']] = ($counts[$row['status']] ?? 0) + 1;
        }
        return $counts;
    }

    public function countSince(int $since, string $clientHash = ''): int
    {
        $n = 0;
        foreach ($this->rows as $row) {
            if ($row['created_at'] >= $since && ($clientHash === '' || $row['client_hash'] === $clientHash)) {
                $n++;
            }
        }
        return $n;
    }

    public function findByEmail(string $email): array
    {
        $out = array_values(array_filter($this->rows, static fn (array $r): bool => $r['email'] === strtolower($email)));
        usort($out, static fn (array $a, array $b): int => [$b['created_at'], $b['id']] <=> [$a['created_at'], $a['id']]);
        return array_map(static fn (array $r): Quote => Quote::fromRow($r), $out);
    }

    public function dueForExpiry(int $now, int $limit): array
    {
        $due = array_filter($this->rows, static fn (array $r): bool =>
            ($r['status'] === Status::QUOTED && $r['expires_at'] > 0 && $r['expires_at'] <= $now)
            || ($r['status'] === Status::APPROVED && $r['pay_by'] > 0 && $r['pay_by'] <= $now));
        usort($due, static fn (array $a, array $b): int => $a['id'] <=> $b['id']);
        return array_map(static fn (array $r): Quote => Quote::fromRow($r), array_slice($due, 0, $limit));
    }

    public function addFile(int $quoteId, string $storedName, string $displayName, string $mime, int $bytes, int $now): QuoteFile
    {
        $file = new QuoteFile($this->nextChildId++, $quoteId, $storedName, $displayName, $mime, $bytes, $now);
        $this->files[$file->id] = $file;
        return $file;
    }

    public function files(int $quoteId): array
    {
        return array_values(array_filter($this->files, static fn (QuoteFile $f): bool => $f->quoteId === $quoteId));
    }

    public function file(int $fileId): ?QuoteFile
    {
        return $this->files[$fileId] ?? null;
    }

    public function removeFiles(int $quoteId): array
    {
        $gone = $this->files($quoteId);
        foreach ($gone as $file) {
            unset($this->files[$file->id]);
        }
        return $gone;
    }

    public function addNote(int $quoteId, int $userId, string $author, string $note, int $now): QuoteNote
    {
        $item = new QuoteNote($this->nextChildId++, $quoteId, $userId, $author, $note, $now);
        $this->notes[$item->id] = $item;
        return $item;
    }

    public function notes(int $quoteId): array
    {
        return array_values(array_filter($this->notes, static fn (QuoteNote $n): bool => $n->quoteId === $quoteId));
    }

    public function eraseNotes(int $quoteId): int
    {
        $n = 0;
        foreach ($this->notes as $id => $note) {
            if ($note->quoteId === $quoteId) {
                $this->notes[$id] = new QuoteNote($note->id, $note->quoteId, $note->userId, $note->author, '[erased]', $note->createdAt);
                $n++;
            }
        }
        return $n;
    }

    public function addEvent(int $quoteId, string $actor, string $kind, string $detail, int $now): void
    {
        $this->events[] = new QuoteEvent($this->nextChildId++, $quoteId, $now, $actor, $kind, $detail);
    }

    public function events(int $quoteId): array
    {
        return array_values(array_filter($this->events, static fn (QuoteEvent $e): bool => $e->quoteId === $quoteId));
    }
}
