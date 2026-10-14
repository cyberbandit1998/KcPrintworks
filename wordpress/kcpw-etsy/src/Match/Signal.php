<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Match;

/** One piece of evidence that an Etsy listing and a WooCommerce product are the same thing. */
final class Signal
{
    public const STORED_ID = 'stored_id';
    public const LISTING_ID_IN_SKU = 'listing_id_in_sku';
    public const PRODUCT_ID_IN_SKU = 'product_id_in_sku';
    public const SKU_EXACT = 'sku_exact';
    public const IMAGE_ID = 'image_id';
    public const TITLE_EXACT = 'title_exact';
    public const TITLE_SIMILAR = 'title_similar';
    public const DESCRIPTION_SIMILAR = 'description_similar';
    public const PRICE_EQUAL = 'price_equal';

    /** Evidence that can establish a match on its own. Titles, descriptions, and prices never can. */
    public const STRONG = [self::STORED_ID, self::LISTING_ID_IN_SKU, self::PRODUCT_ID_IN_SKU, self::SKU_EXACT, self::IMAGE_ID];

    public function __construct(
        public readonly string $type,
        public readonly int $weight,
        public readonly string $detail,
    ) {
    }

    public function strong(): bool
    {
        return in_array($this->type, self::STRONG, true);
    }
}
