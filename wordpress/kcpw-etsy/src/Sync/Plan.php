<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Sync;

/** A complete dry-run: what a synchronization WOULD do. Nothing in it has been done. */
final class Plan
{
    /** @param list<PlanEntry> $entries */
    public function __construct(public readonly array $entries)
    {
    }

    /** @return array<string,mixed> */
    public function toArray(): array
    {
        return array_map(static fn (PlanEntry $e): array => $e->toArray(), $this->entries);
    }

    /** Stable fingerprint, so a later "apply" can refuse a plan that has changed since it was reviewed. */
    public function hash(): string
    {
        return hash('sha256', (string) json_encode($this->toArray(), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
    }

    /** @return array<string,int> */
    public function totals(): array
    {
        $totals = ['entries' => count($this->entries), 'approved' => 0, 'preview_only' => 0, 'with_changes' => 0, 'conflicts' => 0, 'create_draft' => 0];
        foreach ($this->entries as $entry) {
            $entry->approved ? $totals['approved']++ : $totals['preview_only']++;
            $entry->hasChanges() && $totals['with_changes']++;
            ($entry->statusCounts()[PlanItem::CONFLICT] ?? 0) > 0 && $totals['conflicts']++;
            $entry->action === PlanEntry::CREATE_DRAFT && $totals['create_draft']++;
        }
        return $totals;
    }
}
