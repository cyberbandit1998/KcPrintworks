<?php
declare(strict_types=1);

namespace KcPrintworks\Core\Catalog;

final class AttributeOption
{
    /** @param ?string $wcValue the value WooCommerce expects in add-to-cart for this option (term slug, or the option text) */
    public function __construct(public readonly string $slug, public readonly string $name, public readonly ?string $wcValue = null)
    {
    }
}
