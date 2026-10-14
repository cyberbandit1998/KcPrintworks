<?php
declare(strict_types=1);

namespace KcPrintworks\Core\Cart;

use KcPrintworks\Core\Catalog\ProductModel;
use KcPrintworks\Core\Catalog\VariationModel;
use KcPrintworks\Core\Options\OptionValidator;

/**
 * Resolves one cart line the way the storefront's reference does (priceLine in packages/contracts/src/pricing.ts):
 * variation lookup including WooCommerce "Any" attributes, stock and quantity rules, personalization, price.
 * packages/contracts/test/vectors/lines.json is the proof the two agree. Prices come from the product model only.
 */
final class LineResolver
{
    private const ANY = '';

    public function resolve(?ProductModel $product, LineIntent $intent): ResolvedLine
    {
        if ($product === null) {
            return new ResolvedLine($intent, null, null, [], [], [], 0, 0, [
                ['code' => 'unknown_product', 'message' => 'This item is no longer available.'],
            ], null);
        }

        $issues = [];
        $base = $product->priceCents;
        $variation = null;
        $stockStatus = $product->stockStatus;
        $stockQuantity = $product->stockQuantity;
        $selection = [];

        if (!$product->purchasable) {
            $issues[] = ['code' => 'unavailable', 'message' => "{$product->name} is not available to purchase."];
        }

        if ($product->type === 'variable') {
            $varAttrs = $product->variationAttributes();
            $variation = $intent->variationId !== null ? $product->variation($intent->variationId) : null;
            if ($variation === null) {
                $issues[] = ['code' => 'invalid_variation', 'message' => 'Choose a valid option for this item.'];
            } else {
                $base = $variation->priceCents;
                $stockStatus = $variation->stockStatus;
                $stockQuantity = $variation->stockQuantity;

                // A fixed variation supplies its own value; an "Any" attribute must be chosen explicitly.
                $selection = $intent->attributes;
                foreach ($varAttrs as $attr) {
                    $fixed = $variation->attributes[$attr->slug] ?? self::ANY;
                    $chosen = $selection[$attr->slug] ?? null;
                    $lower = strtolower($attr->name);
                    if ($fixed !== self::ANY) {
                        if ($chosen !== null && $chosen !== $fixed) {
                            $issues[] = ['code' => 'invalid_variation', 'message' => "The chosen $lower does not match this variation."];
                        }
                        $selection[$attr->slug] = $fixed;
                    } elseif ($chosen === null || $chosen === '') {
                        $issues[] = ['code' => 'invalid_variation', 'message' => "Choose a $lower."];
                    } elseif ($attr->option($chosen) === null) {
                        $issues[] = ['code' => 'invalid_variation', 'message' => "That $lower is not available."];
                    }
                }
                $known = array_map(static fn ($a): string => $a->slug, $varAttrs);
                foreach (array_keys($selection) as $slug) {
                    if (!in_array((string) $slug, $known, true)) {
                        $issues[] = ['code' => 'invalid_variation', 'message' => 'Unknown variation option.'];
                    }
                }
            }
        } elseif ($intent->variationId !== null || $intent->attributes !== []) {
            $issues[] = ['code' => 'invalid_variation', 'message' => 'This item has no variations.'];
        }

        $unlimited = $product->madeToOrder || $stockStatus === 'onbackorder';
        if ($stockStatus === 'outofstock') {
            $issues[] = ['code' => 'out_of_stock', 'message' => "{$product->name} is out of stock."];
        } elseif (!$unlimited && $stockQuantity !== null && $intent->quantity > $stockQuantity) {
            $issues[] = ['code' => 'quantity_limit', 'message' => "Only $stockQuantity available for {$product->name}."];
        }

        $validation = OptionValidator::validate($product->schema, $intent->options);
        foreach ($validation->issues as $issue) {
            $issues[] = ['code' => 'invalid_option', 'field' => $issue['fieldId'], 'message' => $issue['message']];
        }

        $adders = $validation->ok ? OptionValidator::adders($product->schema, $validation->values, $base) : 0;

        return new ResolvedLine(
            $intent,
            $product,
            $variation,
            $selection,
            $validation->ok ? $validation->values : [],
            $validation->ok ? OptionValidator::summary($product->schema, $validation->values) : [],
            $base + $adders,
            $adders,
            $issues,
            $variation !== null ? self::label($product, $selection) : null,
        );
    }

    /** "Size: Small, Color: Red", using option display names. */
    private static function label(ProductModel $product, array $selection): ?string
    {
        $parts = [];
        foreach ($product->variationAttributes() as $attr) {
            $chosen = $selection[$attr->slug] ?? '';
            if ($chosen === '') {
                continue;
            }
            $option = $attr->option($chosen);
            $parts[] = $attr->name . ': ' . ($option !== null ? $option->name : $chosen);
        }
        return $parts === [] ? null : implode(', ', $parts);
    }
}
