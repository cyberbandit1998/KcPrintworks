<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Sync;

/** An approved exception: the website keeps its own value for an Etsy-owned field on one product. */
final class Override
{
    public function __construct(
        public readonly int $wooProductId,
        public readonly string $field,
        public readonly string $reason,
        public readonly string $approvedBy,
        public readonly string $approvedAt,
    ) {
        if (!FieldPolicy::syncMayWrite($field)) {
            throw new \InvalidArgumentException('Only Etsy-owned fields can have an override: ' . $field);
        }
    }
}
