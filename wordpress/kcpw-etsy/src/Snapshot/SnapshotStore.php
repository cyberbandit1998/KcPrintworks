<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Snapshot;

/** Where the downloaded Etsy data lives (the plugin's own table in WordPress). Never a WooCommerce table. */
interface SnapshotStore
{
    /** @param array<string,mixed> $listing */
    public function saveListing(int $listingId, array $listing): void;

    /**
     * @param array<string,mixed> $inventory
     * @param array<string,mixed> $images
     */
    public function saveDetails(int $listingId, array $inventory, array $images): void;

    /**
     * @param list<int> $exclude ids that already failed in this run
     * @return list<int> listing ids that still lack inventory and images, oldest first
     */
    public function pendingDetailIds(int $limit, array $exclude = []): array;

    /** @return list<array{listing:array<string,mixed>,inventory:array<string,mixed>|null,images:array<string,mixed>|null}> */
    public function all(): array;

    public function count(): int;

    /** Removes listings the shop no longer returns (deleted on Etsy), so the preview never shows ghosts. */
    public function retainOnly(array $listingIds): int;

    public function lastFetchedAt(): ?string;
}
