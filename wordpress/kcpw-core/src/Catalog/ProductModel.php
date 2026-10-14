<?php
declare(strict_types=1);

namespace KcPrintworks\Core\Catalog;

use KcPrintworks\Core\Options\OptionSchema;

/**
 * What the line resolver needs to know about a product. The shape mirrors the storefront's product DTO
 * (packages/contracts/src/product.ts) so the shared vectors can feed it directly; the WordPress layer builds the same
 * model from a WooCommerce product.
 */
final class ProductModel
{
    /**
     * @param list<AttributeModel> $attributes
     * @param list<VariationModel> $variations
     */
    public function __construct(
        public readonly int $id,
        public readonly string $type,
        public readonly string $name,
        public readonly string $currency,
        public readonly int $priceCents,
        public readonly array $attributes,
        public readonly array $variations,
        public readonly OptionSchema $schema,
        public readonly bool $purchasable,
        public readonly string $stockStatus,
        public readonly ?int $stockQuantity,
        public readonly bool $madeToOrder,
    ) {
    }

    /** @return list<AttributeModel> */
    public function variationAttributes(): array
    {
        return array_values(array_filter($this->attributes, static fn (AttributeModel $a): bool => $a->usedForVariations));
    }

    public function variation(int $id): ?VariationModel
    {
        foreach ($this->variations as $variation) {
            if ($variation->id === $id) {
                return $variation;
            }
        }
        return null;
    }

    /** @param array<string,mixed> $dto the storefront product DTO as an associative array */
    public static function fromDto(array $dto): self
    {
        $attributes = [];
        foreach ($dto['attributes'] as $a) {
            $attributes[] = new AttributeModel(
                $a['slug'],
                $a['name'],
                (bool) $a['usedForVariations'],
                array_map(static fn (array $o): AttributeOption => new AttributeOption($o['slug'], $o['name'], $o['wcValue'] ?? null), $a['options']),
                $a['wcKey'] ?? null,
            );
        }
        $variations = array_map(
            static fn (array $v): VariationModel => new VariationModel(
                $v['id'],
                $v['attributes'],
                $v['price']['amount'],
                $v['stockStatus'],
                $v['stockQuantity'] ?? null,
            ),
            $dto['variations'],
        );
        $availability = $dto['availability'];
        return new self(
            $dto['id'],
            $dto['type'],
            $dto['name'],
            $dto['price']['currency'],
            $dto['price']['amount'],
            $attributes,
            $variations,
            OptionSchema::fromDecoded($dto['optionSchema']),
            (bool) $availability['purchasable'],
            $availability['stockStatus'],
            $availability['stockQuantity'] ?? null,
            (bool) $availability['madeToOrder'],
        );
    }
}
