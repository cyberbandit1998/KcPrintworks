<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Wp;

use KcPrintworks\Etsy\Match\Decision;
use KcPrintworks\Etsy\Match\DecisionStore;

final class WpDecisionStore implements DecisionStore
{
    public function all(): array
    {
        global $wpdb;
        $rows = $wpdb->get_results('SELECT * FROM ' . Schema::table('decision'), ARRAY_A);
        $out = [];
        foreach ((array) $rows as $row) {
            $out[(int) $row['etsy_listing_id']] = new Decision(
                (int) $row['etsy_listing_id'],
                (string) $row['type'],
                $row['woo_product_id'] !== null ? (int) $row['woo_product_id'] : null,
                (string) $row['decided_by'],
                (string) $row['decided_at'],
                (string) ($row['note'] ?? ''),
            );
        }
        return $out;
    }

    public function save(Decision $decision): void
    {
        global $wpdb;
        $wpdb->replace(Schema::table('decision'), [
            'etsy_listing_id' => $decision->etsyListingId,
            'type' => $decision->type,
            'woo_product_id' => $decision->wooProductId,
            'decided_by' => $decision->decidedBy,
            'decided_at' => $decision->decidedAt !== '' ? gmdate('Y-m-d H:i:s', (int) strtotime($decision->decidedAt)) : gmdate('Y-m-d H:i:s'),
            'note' => $decision->note,
        ]);
    }

    public function remove(int $etsyListingId): void
    {
        global $wpdb;
        $wpdb->delete(Schema::table('decision'), ['etsy_listing_id' => $etsyListingId]);
    }
}
