<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Snapshot;

/** In-memory store for tests and the command line. */
final class MemorySnapshotStore implements SnapshotStore
{
    /** @var array<int,array{listing:array<string,mixed>,inventory:array<string,mixed>|null,images:array<string,mixed>|null}> */
    private array $rows = [];

    public function saveListing(int $listingId, array $listing): void
    {
        $previous = $this->rows[$listingId] ?? null;
        $changed = $previous === null || (int) ($previous['listing']['updated_timestamp'] ?? 0) !== (int) ($listing['updated_timestamp'] ?? 0);
        $this->rows[$listingId] = [
            'listing' => $listing,
            // Details are fetched again only when the listing changed on Etsy since the last download.
            'inventory' => $changed ? null : $previous['inventory'],
            'images' => $changed ? null : $previous['images'],
        ];
    }

    public function saveDetails(int $listingId, array $inventory, array $images): void
    {
        if (isset($this->rows[$listingId])) {
            $this->rows[$listingId]['inventory'] = $inventory;
            $this->rows[$listingId]['images'] = $images;
        }
    }

    public function pendingDetailIds(int $limit, array $exclude = []): array
    {
        $ids = [];
        foreach ($this->rows as $id => $row) {
            if (in_array($id, $exclude, true)) {
                continue;
            }
            if ($row['inventory'] === null || $row['images'] === null) {
                $ids[] = $id;
                if (count($ids) >= $limit) {
                    break;
                }
            }
        }
        return $ids;
    }

    public function all(): array
    {
        return array_values($this->rows);
    }

    public function count(): int
    {
        return count($this->rows);
    }

    public function retainOnly(array $listingIds): int
    {
        $keep = array_flip($listingIds);
        $removed = 0;
        foreach (array_keys($this->rows) as $id) {
            if (!isset($keep[$id])) {
                unset($this->rows[$id]);
                $removed++;
            }
        }
        return $removed;
    }

    public function lastFetchedAt(): ?string
    {
        return $this->rows === [] ? null : 'memory';
    }
}
