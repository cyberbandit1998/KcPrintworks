<?php
declare(strict_types=1);

namespace KcPrintworks\Core\Cart;

use KcPrintworks\Core\Catalog\ProductModel;
use KcPrintworks\Core\Catalog\VariationModel;

/** One cart line after the server has looked at it: what it would cost and what is wrong with it, if anything. */
final class ResolvedLine
{
    /**
     * @param array<string,string> $selection variation attribute slug => option slug
     * @param array<string,string|bool> $values validated personalization values
     * @param list<array{fieldId:string,label:string,value:string}> $summary
     * @param list<array{code:string,message:string,field?:string}> $issues
     */
    public function __construct(
        public readonly LineIntent $intent,
        public readonly ?ProductModel $product,
        public readonly ?VariationModel $variation,
        public readonly array $selection,
        public readonly array $values,
        public readonly array $summary,
        public readonly int $unitCents,
        public readonly int $addersCents,
        public readonly array $issues,
        public readonly ?string $variationLabel,
    ) {
    }

    public function ok(): bool
    {
        return $this->issues === [];
    }

    public function lineTotalCents(): int
    {
        return $this->unitCents * $this->intent->quantity;
    }

    /**
     * The variation fields WooCommerce's own add-to-cart expects: field name => value, for every attribute that selects
     * a variation (for example ["attribute_pa_color" => "red", "attribute_tag-color" => "Navy"]).
     *
     * @return array<string,string>
     */
    public function wcVariationAttributes(): array
    {
        $out = [];
        if ($this->product === null) {
            return $out;
        }
        foreach ($this->product->variationAttributes() as $attribute) {
            $chosen = $this->selection[$attribute->slug] ?? '';
            $option = $chosen !== '' ? $attribute->option($chosen) : null;
            if ($option === null) {
                continue;
            }
            $out[$attribute->wcKey ?? ('attribute_' . $attribute->slug)] = $option->wcValue ?? $option->name;
        }
        return $out;
    }
}
