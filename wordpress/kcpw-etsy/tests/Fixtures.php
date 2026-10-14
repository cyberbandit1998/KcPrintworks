<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Tests;

use KcPrintworks\Etsy\Etsy\Normalizer;
use KcPrintworks\Etsy\Model\Listing;
use KcPrintworks\Etsy\Woo\WooProduct;
use KcPrintworks\Etsy\Woo\WooVariation;

/**
 * SYNTHETIC data. The Etsy response shapes are written from memory of the public v3 documentation (not captured from
 * the owner's shop, which this environment cannot reach) and must be confirmed on the first real run.
 */
final class Fixtures
{
    /**
     * @param array<string,mixed> $overrides
     * @return array<string,mixed>
     */
    public static function rawListing(int $id, array $overrides = []): array
    {
        return $overrides + [
            'listing_id' => $id,
            'state' => 'active',
            'title' => 'Skip-Bo Card Game Travel Case',
            'description' => 'A 3D printed case for your Skip-Bo cards. Snap closure, fits the full deck, made in Michigan.',
            'url' => 'https://www.etsy.com/listing/' . $id . '/skip-bo-case',
            'tags' => ['skip-bo', 'card game case'],
            'materials' => ['PLA'],
            'price' => ['amount' => 1524, 'divisor' => 100, 'currency_code' => 'USD'],
            'quantity' => 999,
            'when_made' => 'made_to_order',
            'who_made' => 'i_did',
            'has_variations' => true,
            'is_personalizable' => false,
            'personalization_is_required' => false,
            'updated_timestamp' => 1_790_000_000,
        ];
    }

    /**
     * @param list<array{0:int,1:string,2:array<string,string>,3:int,4?:bool}> $products [productId, sku, options, cents, enabled]
     * @return array<string,mixed>
     */
    public static function rawInventory(array $products): array
    {
        $out = [];
        foreach ($products as $p) {
            $values = [];
            foreach ($p[2] as $name => $value) {
                $values[] = ['property_id' => 200, 'property_name' => $name, 'scale_id' => null, 'scale_name' => null, 'value_ids' => [1], 'values' => [$value]];
            }
            $out[] = [
                'product_id' => $p[0], 'sku' => $p[1], 'is_deleted' => false, 'property_values' => $values,
                'offerings' => [['offering_id' => $p[0] + 1, 'quantity' => 5, 'is_enabled' => $p[4] ?? true, 'is_deleted' => false, 'price' => ['amount' => $p[3], 'divisor' => 100, 'currency_code' => 'USD']]],
            ];
        }
        return ['products' => $out];
    }

    /**
     * @param list<int> $imageIds
     * @return array<string,mixed>
     */
    public static function rawImages(array $imageIds): array
    {
        $rows = [];
        foreach ($imageIds as $rank => $imageId) {
            $rows[] = ['listing_image_id' => $imageId, 'rank' => $rank + 1, 'alt_text' => '', 'url_fullxfull' => 'https://i.etsystatic.com/1/r/il/abcd/' . $imageId . '/il_fullxfull.' . $imageId . '_ab12.jpg'];
        }
        return ['count' => count($rows), 'results' => $rows];
    }

    /**
     * @param array<string,mixed> $listingOverrides
     * @param list<array{0:int,1:string,2:array<string,string>,3:int,4?:bool}> $products
     * @param list<int> $imageIds
     */
    public static function listing(int $id, array $listingOverrides = [], array $products = [], array $imageIds = []): Listing
    {
        return (new Normalizer())->normalize(
            self::rawListing($id, $listingOverrides),
            self::rawInventory($products === [] ? [[$id * 10, 'SKU-' . $id, ['Color' => 'Red'], 1524]] : $products),
            self::rawImages($imageIds),
        );
    }

    /**
     * @param list<string> $images
     * @param list<WooVariation> $variations
     */
    public static function woo(int $id, string $title = 'Skip-Bo Card Game Travel Case', array $images = [], string $status = 'publish', string $sku = '', array $variations = [], ?int $cents = 1524, string $description = 'A 3D printed case for your Skip-Bo cards. Snap closure, fits the full deck, made in Michigan.', ?int $etsyListingId = null): WooProduct
    {
        return new WooProduct($id, $variations === [] ? 'simple' : 'variable', $status, $title, 'slug-' . $id, $sku, $description, $cents, $cents, $images, [], [], $variations, $etsyListingId);
    }
}
