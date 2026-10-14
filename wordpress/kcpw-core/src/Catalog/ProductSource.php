<?php
declare(strict_types=1);

namespace KcPrintworks\Core\Catalog;

/** Where products come from. WooCommerce in production (Wp\WcProductSource); an array in tests. */
interface ProductSource
{
    public function find(int $productId): ?ProductModel;
}
