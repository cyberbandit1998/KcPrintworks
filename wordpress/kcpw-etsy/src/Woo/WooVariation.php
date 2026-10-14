<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Woo;

final class WooVariation
{
    /**
     * @param array<string,string> $attributes attribute name => option text ("" means WooCommerce "Any")
     */
    public function __construct(
        public readonly int $id,
        public readonly string $sku,
        public readonly array $attributes,
        public readonly ?int $priceCents,
        public readonly string $status,
        public readonly string $stockStatus,
        public readonly ?int $etsyProductId = null,
    ) {
    }
}
