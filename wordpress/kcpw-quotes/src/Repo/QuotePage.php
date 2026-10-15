<?php
declare(strict_types=1);

namespace KcPrintworks\Quotes\Repo;

use KcPrintworks\Quotes\Domain\Quote;

final class QuotePage
{
    /** @param list<Quote> $items */
    public function __construct(public readonly array $items, public readonly int $total, public readonly int $page, public readonly int $perPage)
    {
    }

    public function pages(): int
    {
        return max(1, (int) ceil($this->total / max(1, $this->perPage)));
    }
}
