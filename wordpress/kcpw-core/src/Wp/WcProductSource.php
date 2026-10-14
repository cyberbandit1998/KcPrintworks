<?php
declare(strict_types=1);

namespace KcPrintworks\Core\Wp;

use KcPrintworks\Core\Catalog\AttributeModel;
use KcPrintworks\Core\Catalog\AttributeOption;
use KcPrintworks\Core\Catalog\ProductModel;
use KcPrintworks\Core\Catalog\ProductSource;
use KcPrintworks\Core\Catalog\VariationModel;
use KcPrintworks\Core\Options\OptionSchema;
use KcPrintworks\Core\Options\SchemaError;
use KcPrintworks\Core\Support\Money;
use KcPrintworks\Core\Support\Slug;

/**
 * Builds the product model from WooCommerce's own product objects. Only standard WooCommerce data is read (price,
 * stock, attributes, variations, status) plus our own meta; nothing here knows or cares which tool put the product
 * there. The slugs match the storefront's (Slug::of), so a choice made on the storefront is recognised here.
 */
final class WcProductSource implements ProductSource
{
    public const META_SCHEMA = '_kcpw_option_schema';
    public const META_MADE_TO_ORDER = '_kcpw_made_to_order';

    public function find(int $productId): ?ProductModel
    {
        $product = wc_get_product($productId);
        if (!($product instanceof \WC_Product) || $product->get_status() !== 'publish') {
            return null;
        }
        $type = $product->get_type();
        if ($type !== 'simple' && $type !== 'variable') {
            return null;
        }
        $decimals = (int) wc_get_price_decimals();
        $currency = (string) get_woocommerce_currency();

        [$schema, $schemaOk] = $this->schemaOf($product);
        $attributes = $type === 'variable' ? $this->attributesOf($product) : [];
        $variations = $type === 'variable' ? $this->variationsOf($product, $attributes, $decimals) : [];

        $priceString = $type === 'variable' ? (string) $product->get_variation_price('min', false) : (string) $product->get_price();
        $price = Money::parse($priceString, $decimals);
        $backorders = (bool) $product->backorders_allowed();
        $quantity = $product->managing_stock() && !$backorders ? max(0, (int) $product->get_stock_quantity()) : null;

        return new ProductModel(
            $product->get_id(),
            $type,
            (string) $product->get_name(),
            $currency,
            $price ?? 0,
            $attributes,
            $variations,
            $schema,
            $schemaOk && $price !== null && $product->is_purchasable(),
            (string) $product->get_stock_status(),
            $quantity,
            $this->madeToOrder($product),
        );
    }

    /** @return array{0:OptionSchema,1:bool} the schema, and false if a stored schema is broken (the product is then not sold) */
    private function schemaOf(\WC_Product $product): array
    {
        $json = $product->get_meta(self::META_SCHEMA, true);
        if (!is_string($json) || trim($json) === '') {
            return [OptionSchema::empty(), true];
        }
        try {
            return [OptionSchema::fromJson($json), true];
        } catch (SchemaError $e) {
            return [OptionSchema::empty(), false];
        }
    }

    private function madeToOrder(\WC_Product $product): bool
    {
        $flag = $product->get_meta(self::META_MADE_TO_ORDER, true);
        return in_array(strtolower((string) $flag), ['1', 'yes', 'true'], true) || has_term('made-to-order', 'product_tag', $product->get_id());
    }

    /** @return list<AttributeModel> */
    private function attributesOf(\WC_Product $product): array
    {
        $raw = [];
        foreach ($product->get_attributes() as $attribute) {
            $raw[] = $attribute;
        }
        $labels = array_map(static fn ($a): string => (string) wc_attribute_label($a->get_name(), $product), $raw);
        $slugs = Slug::uniqueList($labels);
        $out = [];
        foreach ($raw as $i => $attribute) {
            $names = [];
            $wcValues = [];
            if ($attribute->is_taxonomy()) {
                foreach ((array) $attribute->get_terms() as $term) {
                    $names[] = (string) $term->name;
                    $wcValues[] = (string) $term->slug;
                }
            } else {
                foreach ($attribute->get_options() as $text) {
                    $names[] = (string) $text;
                    $wcValues[] = (string) $text;
                }
            }
            if ($names === []) {
                continue;
            }
            $optionSlugs = Slug::uniqueList($names);
            $options = [];
            foreach ($names as $n => $name) {
                $options[] = new AttributeOption($optionSlugs[$n], $name, $wcValues[$n]);
            }
            $out[] = new AttributeModel($slugs[$i], $labels[$i], (bool) $attribute->get_variation(), $options, 'attribute_' . sanitize_title($attribute->get_name()));
        }
        return $out;
    }

    /**
     * @param list<AttributeModel> $attributes
     * @return list<VariationModel>
     */
    private function variationsOf(\WC_Product $product, array $attributes, int $decimals): array
    {
        $varAttrs = array_values(array_filter($attributes, static fn (AttributeModel $a): bool => $a->usedForVariations));
        $out = [];
        foreach ($product->get_children() as $childId) {
            $variation = wc_get_product($childId);
            if (!($variation instanceof \WC_Product_Variation) || $variation->get_status() !== 'publish' || !$variation->is_purchasable()) {
                continue;
            }
            $price = Money::parse((string) $variation->get_price(), $decimals);
            if ($price === null) {
                continue;
            }
            $own = $variation->get_variation_attributes(true);
            $selection = [];
            $valid = true;
            foreach ($varAttrs as $attr) {
                $value = (string) ($own[$attr->wcKey ?? ''] ?? '');
                if ($value === '') {
                    $selection[$attr->slug] = '';
                    continue;
                }
                $match = null;
                foreach ($attr->options as $option) {
                    if ($option->wcValue === $value || $option->slug === Slug::of($value)) {
                        $match = $option;
                        break;
                    }
                }
                if ($match === null) {
                    $valid = false;
                    break;
                }
                $selection[$attr->slug] = $match->slug;
            }
            if (!$valid) {
                continue;
            }
            $backorders = (bool) $variation->backorders_allowed();
            $quantity = $variation->managing_stock() && !$backorders ? max(0, (int) $variation->get_stock_quantity()) : null;
            $out[] = new VariationModel($variation->get_id(), $selection, $price, (string) $variation->get_stock_status(), $quantity);
        }
        return $out;
    }
}
