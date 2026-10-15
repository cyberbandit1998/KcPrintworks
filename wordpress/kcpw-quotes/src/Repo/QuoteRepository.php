<?php
declare(strict_types=1);

namespace KcPrintworks\Quotes\Repo;

use KcPrintworks\Quotes\Domain\Quote;

/**
 * Where quotes, their pictures, notes and history are kept. Two implementations: MemoryQuoteRepository (the workflow tests) and
 * WpdbQuoteRepository (the site). One contract test runs against both.
 *
 * Every change to a quote is `swap()`: a compare-and-swap that applies only if the row is still in a state the caller expects. That is
 * what stops two clicks, two browser tabs, two payment notifications or a cron run from both "winning".
 */
interface QuoteRepository
{
    /**
     * @param array<string,mixed> $fields columns for the new quote (see Rows::DEFAULTS); the id and anything missing are filled in
     * @throws RefTaken when the reference is already used
     */
    public function create(array $fields): Quote;

    public function find(int $id): ?Quote;

    public function findByRef(string $ref): ?Quote;

    public function findByOrderId(int $orderId): ?Quote;

    /**
     * Apply `$changes` (and `updated_at = $now`) only if the quote's status is one of `$fromStatuses` (empty = any) and every
     * `$guard` column still has the given value. True when exactly one row was changed, false when the quote had moved on.
     *
     * @param list<string> $fromStatuses
     * @param array<string,mixed> $changes
     * @param array<string,mixed> $guard
     */
    public function swap(int $id, array $fromStatuses, array $changes, array $guard, int $now): bool;

    public function search(QuoteQuery $query): QuotePage;

    /** @return array<string,int> status => number of quotes, for every status (zero included) */
    public function counts(): array;

    /** Number of quotes made since `$since`, all of them or only those from one visitor (their keyed hash). */
    public function countSince(int $since, string $clientHash = ''): int;

    /** @return list<Quote> quotes by this email address (any status), newest first, for the privacy tools and for spotting repeats */
    public function findByEmail(string $email): array;

    /** @return list<Quote> quotes whose time has run out: Quoted past their expiry, Approved past their payment window */
    public function dueForExpiry(int $now, int $limit): array;

    public function addFile(int $quoteId, string $storedName, string $displayName, string $mime, int $bytes, int $now): QuoteFile;

    /** @return list<QuoteFile> */
    public function files(int $quoteId): array;

    public function file(int $fileId): ?QuoteFile;

    /** Removes the records and returns them (so the caller can delete the files on disk). @return list<QuoteFile> */
    public function removeFiles(int $quoteId): array;

    public function addNote(int $quoteId, int $userId, string $author, string $note, int $now): QuoteNote;

    /** @return list<QuoteNote> oldest first */
    public function notes(int $quoteId): array;

    /** Replaces the text of every note on a quote with a marker (privacy erasure). Returns how many notes were changed. */
    public function eraseNotes(int $quoteId): int;

    public function addEvent(int $quoteId, string $actor, string $kind, string $detail, int $now): void;

    /** @return list<QuoteEvent> oldest first */
    public function events(int $quoteId): array;
}
