<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Model;

/** An Etsy listing in the shape the rest of the plugin uses. Built by Etsy\Normalizer from raw API responses. */
final class Listing
{
    /**
     * @param list<string> $tags
     * @param list<string> $materials
     * @param list<ListingImage> $images
     * @param list<Variant> $variants
     * @param list<string> $variationProperties names such as "Tag Color"
     * @param list<string> $warnings places where the API response did not look as expected (schema drift)
     */
    public function __construct(
        public readonly int $id,
        public readonly string $state,
        public readonly string $title,
        public readonly string $description,
        public readonly string $url,
        public readonly array $tags,
        public readonly array $materials,
        public readonly ?Money $price,
        public readonly bool $hasVariations,
        public readonly string $whenMade,
        public readonly string $whoMade,
        public readonly int $quantity,
        public readonly Personalization $personalization,
        public readonly array $images,
        public readonly array $variants,
        public readonly array $variationProperties,
        public readonly int $updatedTimestamp,
        public readonly array $warnings = [],
    ) {
    }

    public function madeToOrder(): bool
    {
        return $this->whenMade === 'made_to_order';
    }

    /** Lowest enabled variant price, else the listing price. */
    public function basePrice(): ?Money
    {
        $lowest = null;
        foreach ($this->variants as $variant) {
            if ($variant->deleted || !$variant->enabled || $variant->price === null) {
                continue;
            }
            if ($lowest === null || $variant->price->toCents() < $lowest->toCents()) {
                $lowest = $variant->price;
            }
        }
        return $lowest ?? $this->price;
    }

    /** @return list<string> every SKU on the listing and its variants */
    public function skus(): array
    {
        $skus = [];
        foreach ($this->variants as $variant) {
            if ($variant->sku !== '') {
                $skus[] = $variant->sku;
            }
        }
        return array_values(array_unique($skus));
    }

    /** @return list<int> */
    public function imageIds(): array
    {
        return array_map(static fn (ListingImage $i): int => $i->id, $this->images);
    }
}
