<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Woo;

/** Source of WooCommerce products. Implementations only READ (WordPress database, a CSV export, a REST snapshot). */
interface WooReader
{
    /** @return list<WooProduct> */
    public function products(): array;
}
