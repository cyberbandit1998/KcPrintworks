<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Sync;

/**
 * Three-way comparison for one field. `$base` is the hash of the value at the last synchronization (null before the
 * first one), `$etsy` and `$woo` are hashes of the current values.
 */
final class ConflictDetector
{
    /** @return array{status:string,note:string} */
    public static function classify(?string $base, string $etsy, string $woo): array
    {
        if ($etsy === $woo) {
            return ['status' => PlanItem::IN_SYNC, 'note' => ''];
        }
        if ($base === null) {
            return ['status' => PlanItem::CHANGE, 'note' => 'First synchronization: the website value would be replaced with Etsy\'s.'];
        }
        $etsyChanged = $etsy !== $base;
        $wooChanged = $woo !== $base;
        if ($etsyChanged && $wooChanged) {
            return ['status' => PlanItem::CONFLICT, 'note' => 'Changed on both Etsy and the website since the last synchronization. Choose which to keep.'];
        }
        if ($wooChanged) {
            return ['status' => PlanItem::WEBSITE_EDIT, 'note' => 'The website value was edited since the last synchronization. Synchronizing would restore Etsy\'s value; add an override to keep the website\'s.'];
        }
        return ['status' => PlanItem::CHANGE, 'note' => 'Changed on Etsy since the last synchronization.'];
    }

    public static function hash(string $value): string
    {
        return hash('sha256', $value);
    }
}
