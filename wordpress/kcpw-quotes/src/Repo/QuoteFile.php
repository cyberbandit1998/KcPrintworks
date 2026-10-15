<?php
declare(strict_types=1);

namespace KcPrintworks\Quotes\Repo;

/** A picture a customer attached. `storedName` is the random name on disk (no extension); `displayName` is what the owner sees. */
final class QuoteFile
{
    public function __construct(
        public readonly int $id,
        public readonly int $quoteId,
        public readonly string $storedName,
        public readonly string $displayName,
        public readonly string $mime,
        public readonly int $bytes,
        public readonly int $createdAt,
    ) {
    }
}
