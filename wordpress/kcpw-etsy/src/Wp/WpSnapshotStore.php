<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Wp;

use KcPrintworks\Etsy\Snapshot\SnapshotStore;

final class WpSnapshotStore implements SnapshotStore
{
    public function saveListing(int $listingId, array $listing): void
    {
        global $wpdb;
        $table = Schema::table('snapshot');
        $updated = (int) ($listing['updated_timestamp'] ?? $listing['last_modified_timestamp'] ?? 0);
        $existing = $wpdb->get_row($wpdb->prepare('SELECT etsy_updated, inventory, images FROM ' . $table . ' WHERE listing_id = %d', $listingId), ARRAY_A);
        $unchanged = is_array($existing) && (int) $existing['etsy_updated'] === $updated && $existing['inventory'] !== null && $existing['images'] !== null;
        $wpdb->replace(Schema::table('snapshot'), [
            'listing_id' => $listingId,
            'listing' => (string) \wp_json_encode($listing),
            // Keep the downloaded details while the listing has not been edited on Etsy.
            'inventory' => $unchanged ? $existing['inventory'] : null,
            'images' => $unchanged ? $existing['images'] : null,
            'etsy_updated' => $updated,
            'fetched_at' => gmdate('Y-m-d H:i:s'),
        ]);
    }

    public function saveDetails(int $listingId, array $inventory, array $images): void
    {
        global $wpdb;
        $wpdb->update(Schema::table('snapshot'), [
            'inventory' => (string) \wp_json_encode($inventory),
            'images' => (string) \wp_json_encode($images),
        ], ['listing_id' => $listingId]);
    }

    public function pendingDetailIds(int $limit, array $exclude = []): array
    {
        global $wpdb;
        $table = Schema::table('snapshot');
        $ids = array_map('intval', $exclude);
        $skip = $ids === [] ? '' : ' AND listing_id NOT IN (' . implode(',', $ids) . ')';
        $rows = $wpdb->get_col($wpdb->prepare('SELECT listing_id FROM ' . $table . ' WHERE (inventory IS NULL OR images IS NULL)' . $skip . ' ORDER BY listing_id ASC LIMIT %d', $limit));
        return array_map('intval', (array) $rows);
    }

    public function all(): array
    {
        global $wpdb;
        $rows = $wpdb->get_results('SELECT listing, inventory, images FROM ' . Schema::table('snapshot') . ' ORDER BY listing_id ASC', ARRAY_A);
        $out = [];
        foreach ((array) $rows as $row) {
            $out[] = [
                'listing' => (array) json_decode((string) $row['listing'], true),
                'inventory' => $row['inventory'] !== null ? (array) json_decode((string) $row['inventory'], true) : null,
                'images' => $row['images'] !== null ? (array) json_decode((string) $row['images'], true) : null,
            ];
        }
        return $out;
    }

    public function count(): int
    {
        global $wpdb;
        return (int) $wpdb->get_var('SELECT COUNT(*) FROM ' . Schema::table('snapshot'));
    }

    public function retainOnly(array $listingIds): int
    {
        global $wpdb;
        $table = Schema::table('snapshot');
        $keep = array_map('intval', $listingIds);
        if ($keep === []) {
            return 0;
        }
        $removed = $wpdb->query('DELETE FROM ' . Schema::table('snapshot') . ' WHERE listing_id NOT IN (' . implode(',', $keep) . ')');
        return is_int($removed) ? $removed : 0;
    }

    public function lastFetchedAt(): ?string
    {
        global $wpdb;
        $value = $wpdb->get_var('SELECT MAX(fetched_at) FROM ' . Schema::table('snapshot'));
        return is_string($value) ? $value : null;
    }
}
