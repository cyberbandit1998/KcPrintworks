<?php
declare(strict_types=1);

namespace KcPrintworks\Quotes\Repo;

/** One line of a quote's history: who (a person, the customer, or the system), what, and when. */
final class QuoteEvent
{
    public function __construct(
        public readonly int $id,
        public readonly int $quoteId,
        public readonly int $at,
        public readonly string $actor,
        public readonly string $kind,
        public readonly string $detail,
    ) {
    }
}
