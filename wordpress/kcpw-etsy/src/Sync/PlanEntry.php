<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Sync;

final class PlanEntry
{
    public const UPDATE = 'update';
    public const CREATE_DRAFT = 'create_draft';
    public const NONE = 'none';

    /**
     * @param list<PlanItem> $items
     * @param list<string> $warnings
     * @param array<string,mixed> $variations summary and per-variant actions
     */
    public function __construct(
        public readonly int $listingId,
        public readonly string $listingTitle,
        public readonly ?int $wooId,
        public readonly string $action,
        public readonly bool $approved,
        public readonly array $items,
        public readonly array $variations = [],
        public readonly array $warnings = [],
    ) {
    }

    /** @return array<string,int> */
    public function statusCounts(): array
    {
        $counts = [];
        foreach ($this->items as $item) {
            $counts[$item->status] = ($counts[$item->status] ?? 0) + 1;
        }
        return $counts;
    }

    public function hasChanges(): bool
    {
        foreach ($this->items as $item) {
            if (in_array($item->status, [PlanItem::CHANGE, PlanItem::CONFLICT, PlanItem::WEBSITE_EDIT], true)) {
                return true;
            }
        }
        return false;
    }

    /** @return array<string,mixed> */
    public function toArray(): array
    {
        return [
            'listing_id' => $this->listingId,
            'listing_title' => $this->listingTitle,
            'woo_id' => $this->wooId,
            'action' => $this->action,
            'approved' => $this->approved,
            'items' => array_map(static fn (PlanItem $i): array => $i->toArray(), $this->items),
            'variations' => $this->variations,
            'warnings' => $this->warnings,
        ];
    }
}
