<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Woo;

/** A WooCommerce product as the matcher and planner see it. Read-only data; nothing here can write back. */
final class WooProduct
{
    /**
     * @param list<string> $imageFilenames file names of the product's images, in order
     * @param list<string> $categories
     * @param list<WooVariation> $variations
     * @param array<string,string> $attributes name => comma separated options (non-variation attributes included)
     */
    public function __construct(
        public readonly int $id,
        public readonly string $type,
        public readonly string $status,
        public readonly string $title,
        public readonly string $slug,
        public readonly string $sku,
        public readonly string $description,
        public readonly ?int $priceCents,
        public readonly ?int $regularPriceCents,
        public readonly array $imageFilenames,
        public readonly array $categories,
        public readonly array $attributes,
        public readonly array $variations,
        public readonly ?int $etsyListingId = null,
        public readonly string $modified = '',
        public readonly bool $manageStock = false,
    ) {
    }

    public function published(): bool
    {
        return $this->status === 'publish';
    }

    /** @return list<string> every SKU on the product and its variations */
    public function skus(): array
    {
        $skus = $this->sku !== '' ? [$this->sku] : [];
        foreach ($this->variations as $variation) {
            if ($variation->sku !== '') {
                $skus[] = $variation->sku;
            }
        }
        return array_values(array_unique($skus));
    }
}
