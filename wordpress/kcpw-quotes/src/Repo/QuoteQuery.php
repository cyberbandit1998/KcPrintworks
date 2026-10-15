<?php
declare(strict_types=1);

namespace KcPrintworks\Quotes\Repo;

/** A page of the dashboard list: optional status, optional search words, newest first. */
final class QuoteQuery
{
    public const PER_PAGE = 20;

    public function __construct(
        public readonly string $status = '',
        public readonly string $search = '',
        public readonly int $page = 1,
        public readonly int $perPage = self::PER_PAGE,
        public readonly bool $attentionOnly = false,
    ) {
    }
}
