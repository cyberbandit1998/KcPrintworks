<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Etsy;

use KcPrintworks\Etsy\Model\Listing;
use KcPrintworks\Etsy\Model\ListingImage;
use KcPrintworks\Etsy\Model\Money;
use KcPrintworks\Etsy\Model\Personalization;
use KcPrintworks\Etsy\Model\Variant;

/**
 * Turns raw Etsy API JSON (listing, inventory, images) into the plugin's Listing model.
 *
 * Field names follow the public v3 documentation from memory and are To verify on the first real run. The
 * normalizer therefore never throws on a missing field: it records a warning, which the connection screen's "API
 * shape check" surfaces, so a difference between this code and Etsy's real responses is visible at once.
 */
final class Normalizer
{
    /** @var list<string> keys the listing response is expected to carry */
    public const EXPECTED_LISTING_KEYS = ['listing_id', 'title', 'description', 'state', 'url', 'price', 'tags', 'when_made', 'who_made', 'updated_timestamp', 'is_personalizable'];

    /** @var list<string> */
    public const EXPECTED_INVENTORY_KEYS = ['products'];

    /** @var list<string> */
    public const EXPECTED_PRODUCT_KEYS = ['product_id', 'sku', 'offerings', 'property_values'];

    /**
     * @param array<string,mixed> $listing
     * @param array<string,mixed>|null $inventory
     * @param array<string,mixed>|null $images response of the images endpoint, or null if the listing embeds them
     */
    public function normalize(array $listing, ?array $inventory = null, ?array $images = null): Listing
    {
        $warnings = [];
        $id = (int) ($listing['listing_id'] ?? 0);
        foreach (self::EXPECTED_LISTING_KEYS as $key) {
            if (!array_key_exists($key, $listing)) {
                $warnings[] = sprintf('listing %d: missing "%s"', $id, $key);
            }
        }

        $imageRows = $images['results'] ?? ($listing['images'] ?? []);
        $imageObjects = [];
        foreach ((array) $imageRows as $row) {
            if (!is_array($row) || !isset($row['listing_image_id'])) {
                $warnings[] = sprintf('listing %d: an image has no listing_image_id', $id);
                continue;
            }
            $imageObjects[] = new ListingImage(
                (int) $row['listing_image_id'],
                (int) ($row['rank'] ?? 0),
                (string) ($row['url_fullxfull'] ?? $row['url_570xN'] ?? ''),
                (string) ($row['alt_text'] ?? ''),
            );
        }
        usort($imageObjects, static fn (ListingImage $a, ListingImage $b): int => $a->rank <=> $b->rank);

        [$variants, $properties] = $this->variants($id, $inventory, $warnings);

        return new Listing(
            $id,
            (string) ($listing['state'] ?? ''),
            trim((string) ($listing['title'] ?? '')),
            (string) ($listing['description'] ?? ''),
            (string) ($listing['url'] ?? ''),
            array_values(array_map('strval', (array) ($listing['tags'] ?? []))),
            array_values(array_map('strval', (array) ($listing['materials'] ?? []))),
            is_array($listing['price'] ?? null) ? Money::fromEtsy($listing['price']) : null,
            (bool) ($listing['has_variations'] ?? ($variants !== [] && count($variants) > 1)),
            (string) ($listing['when_made'] ?? ''),
            (string) ($listing['who_made'] ?? ''),
            (int) ($listing['quantity'] ?? 0),
            new Personalization(
                (bool) ($listing['is_personalizable'] ?? false),
                (bool) ($listing['personalization_is_required'] ?? false),
                isset($listing['personalization_char_count_max']) ? (int) $listing['personalization_char_count_max'] : null,
                (string) ($listing['personalization_instructions'] ?? ''),
            ),
            $imageObjects,
            $variants,
            $properties,
            (int) ($listing['updated_timestamp'] ?? $listing['last_modified_timestamp'] ?? 0),
            $warnings,
        );
    }

    /**
     * @param array<string,mixed>|null $inventory
     * @param list<string> $warnings
     * @return array{0:list<Variant>,1:list<string>}
     */
    private function variants(int $listingId, ?array $inventory, array &$warnings): array
    {
        if ($inventory === null) {
            $warnings[] = sprintf('listing %d: inventory was not downloaded, so variations are unknown', $listingId);
            return [[], []];
        }
        if (!isset($inventory['products']) || !is_array($inventory['products'])) {
            $warnings[] = sprintf('listing %d: inventory has no "products" list', $listingId);
            return [[], []];
        }
        $variants = [];
        $properties = [];
        foreach ($inventory['products'] as $product) {
            if (!is_array($product)) {
                continue;
            }
            foreach (self::EXPECTED_PRODUCT_KEYS as $key) {
                if (!array_key_exists($key, $product)) {
                    $warnings[] = sprintf('listing %d: an inventory product is missing "%s"', $listingId, $key);
                }
            }
            $options = [];
            foreach ((array) ($product['property_values'] ?? []) as $pv) {
                if (!is_array($pv)) {
                    continue;
                }
                $name = (string) ($pv['property_name'] ?? '');
                $values = implode(', ', array_map('strval', (array) ($pv['values'] ?? [])));
                if ($name !== '') {
                    $options[$name] = $values;
                    $properties[$name] = true;
                }
            }
            $offering = (array) (($product['offerings'] ?? [])[0] ?? []);
            $variants[] = new Variant(
                (int) ($product['product_id'] ?? 0),
                (string) ($product['sku'] ?? ''),
                $options,
                is_array($offering['price'] ?? null) ? Money::fromEtsy($offering['price']) : null,
                (int) ($offering['quantity'] ?? 0),
                (bool) ($offering['is_enabled'] ?? true),
                (bool) ($product['is_deleted'] ?? false) || (bool) ($offering['is_deleted'] ?? false),
            );
        }
        return [$variants, array_keys($properties)];
    }
}
