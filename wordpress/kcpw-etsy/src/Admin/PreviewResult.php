<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Admin;

use KcPrintworks\Etsy\Match\MatchReport;
use KcPrintworks\Etsy\Model\Listing;
use KcPrintworks\Etsy\Sync\Plan;
use KcPrintworks\Etsy\Woo\WooProduct;

final class PreviewResult
{
    /**
     * @param list<Listing> $listings
     * @param list<WooProduct> $products
     */
    public function __construct(
        public readonly array $listings,
        public readonly array $products,
        public readonly MatchReport $report,
        public readonly Plan $plan,
        public readonly string $generatedAt,
    ) {
    }
}
