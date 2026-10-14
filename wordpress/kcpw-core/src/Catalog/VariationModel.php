<?php
declare(strict_types=1);

namespace KcPrintworks\Core\Catalog;

final class VariationModel
{
    /**
     * @param array<string,string> $attributes attribute slug => option slug; the empty string is WooCommerce's "Any"
     */
    public function __construct(
        public readonly int $id,
        public readonly array $attributes,
        public readonly int $priceCents,
        public readonly string $stockStatus,
        public readonly ?int $stockQuantity = null,
    ) {
    }
}
