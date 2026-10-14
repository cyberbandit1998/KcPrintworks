<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Admin;

/**
 * Permanent Etsy listing id to WooCommerce product id mappings. They are created only by an approved synchronization,
 * which does not exist in the read-only phase, so the only implementation returns nothing.
 */
interface MappingStore
{
    /** @return array<int,int> Etsy listing id => Woo product id */
    public function all(): array;
}
