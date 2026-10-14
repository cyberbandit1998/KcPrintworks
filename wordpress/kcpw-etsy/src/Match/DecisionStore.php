<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Match;

interface DecisionStore
{
    /** @return array<int,Decision> keyed by Etsy listing id */
    public function all(): array;

    public function save(Decision $decision): void;

    public function remove(int $etsyListingId): void;
}
