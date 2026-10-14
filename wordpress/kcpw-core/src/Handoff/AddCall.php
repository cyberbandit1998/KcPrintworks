<?php
declare(strict_types=1);

namespace KcPrintworks\Core\Handoff;

/** One call to WooCommerce's add-to-cart, fully validated. */
final class AddCall
{
    /**
     * @param array<string,string> $variationAttributes WooCommerce field name => value
     * @param array<string,string|bool> $options validated personalization values
     * @param list<array{fieldId:string,label:string,value:string}> $summary
     */
    public function __construct(
        public readonly int $productId,
        public readonly int $variationId,
        public readonly int $quantity,
        public readonly array $variationAttributes,
        public readonly array $options,
        public readonly array $summary,
    ) {
    }
}
