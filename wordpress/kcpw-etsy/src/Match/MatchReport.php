<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Match;

use KcPrintworks\Etsy\Woo\WooProduct;

final class MatchReport
{
    /**
     * @param list<Entry> $entries one per Etsy listing
     * @param list<WooProduct> $wooOnly Woo products that no Etsy listing claims
     * @param array<int,WooProduct> $wooById
     */
    public function __construct(
        public readonly array $entries,
        public readonly array $wooOnly,
        public readonly array $wooById,
    ) {
    }

    /** @return array<string,int> */
    public function counts(): array
    {
        $counts = [
            Entry::MAPPED => 0, Entry::MAPPED_MISSING => 0, Entry::APPROVED => 0, Entry::APPROVED_NEW => 0,
            Entry::PROPOSED => 0, Entry::AMBIGUOUS => 0, Entry::NEW => 0, Entry::IGNORED => 0,
        ];
        foreach ($this->entries as $entry) {
            $counts[$entry->status]++;
        }
        $counts['listings'] = count($this->entries);
        $counts['woo_only'] = count($this->wooOnly);
        return $counts;
    }

    public function entryFor(int $listingId): ?Entry
    {
        foreach ($this->entries as $entry) {
            if ($entry->listing->id === $listingId) {
                return $entry;
            }
        }
        return null;
    }

    /** True when every listing is settled, so a first synchronization could be offered for approval. */
    public function allSettled(): bool
    {
        foreach ($this->entries as $entry) {
            if (!$entry->settled() && $entry->status !== Entry::NEW) {
                return false;
            }
        }
        return true;
    }
}
