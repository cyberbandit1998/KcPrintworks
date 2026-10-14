<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Match;

/** In-memory (tests and the command line). The WordPress implementation stores decisions in the plugin's own table. */
final class ArrayDecisionStore implements DecisionStore
{
    /** @param array<int,Decision> $decisions */
    public function __construct(private array $decisions = [])
    {
    }

    /** @param list<array<string,mixed>> $rows */
    public static function fromRows(array $rows): self
    {
        $store = new self();
        foreach ($rows as $row) {
            $store->save(Decision::fromArray($row));
        }
        return $store;
    }

    public function all(): array
    {
        return $this->decisions;
    }

    public function save(Decision $decision): void
    {
        $this->decisions[$decision->etsyListingId] = $decision;
    }

    public function remove(int $etsyListingId): void
    {
        unset($this->decisions[$etsyListingId]);
    }
}
