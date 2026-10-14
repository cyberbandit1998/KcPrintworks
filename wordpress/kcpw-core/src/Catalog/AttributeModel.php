<?php
declare(strict_types=1);

namespace KcPrintworks\Core\Catalog;

final class AttributeModel
{
    /**
     * @param list<AttributeOption> $options
     * @param ?string $wcKey the add-to-cart field name WooCommerce uses, for example "attribute_pa_color"
     */
    public function __construct(
        public readonly string $slug,
        public readonly string $name,
        public readonly bool $usedForVariations,
        public readonly array $options,
        public readonly ?string $wcKey = null,
    ) {
    }

    public function option(string $slug): ?AttributeOption
    {
        foreach ($this->options as $option) {
            if ($option->slug === $slug) {
                return $option;
            }
        }
        return null;
    }
}
