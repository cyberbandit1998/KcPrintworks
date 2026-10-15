<?php
declare(strict_types=1);

namespace KcPrintworks\Quotes\Repo;

/** A private note by the owner or staff. Never shown to the customer, never sent in any email. */
final class QuoteNote
{
    public function __construct(
        public readonly int $id,
        public readonly int $quoteId,
        public readonly int $userId,
        public readonly string $author,
        public readonly string $note,
        public readonly int $createdAt,
    ) {
    }
}
