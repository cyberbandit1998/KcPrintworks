<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Wp;

use KcPrintworks\Etsy\Woo\Text;
use KcPrintworks\Etsy\Woo\WooProduct;
use KcPrintworks\Etsy\Woo\WooReader;
use KcPrintworks\Etsy\Woo\WooVariation;

/** Reads products through WooCommerce's own getters. READ-ONLY: it never calls a setter or save(). */
final class WpWooReader implements WooReader
{
    public function products(): array
    {
        if (!\function_exists('wc_get_products')) {
            return [];
        }
        $ids = \wc_get_products(['limit' => -1, 'return' => 'ids', 'status' => ['publish', 'draft', 'private', 'pending'], 'type' => ['simple', 'variable'], 'orderby' => 'ID', 'order' => 'ASC']);
        $out = [];
        foreach ((array) $ids as $id) {
            $product = \wc_get_product($id);
            if (!$product) {
                continue;
            }
            $out[] = $this->convert($product);
        }
        return $out;
    }

    private function convert(\WC_Product $product): WooProduct
    {
        $imageIds = array_filter(array_merge([(int) $product->get_image_id()], array_map('intval', (array) $product->get_gallery_image_ids())));
        $filenames = [];
        foreach ($imageIds as $imageId) {
            $url = (string) \wp_get_attachment_url($imageId);
            if ($url !== '') {
                $filenames[] = basename((string) parse_url($url, PHP_URL_PATH));
            }
        }
        $attributes = [];
        foreach ((array) $product->get_attributes() as $attribute) {
            if (!$attribute instanceof \WC_Product_Attribute) {
                continue;
            }
            $label = \wc_attribute_label($attribute->get_name(), $product);
            $attributes[$label] = $attribute->is_taxonomy()
                ? implode(', ', (array) \wc_get_product_terms($product->get_id(), $attribute->get_name(), ['fields' => 'names']))
                : implode(', ', array_map('strval', (array) $attribute->get_options()));
        }
        $variations = [];
        if ($product instanceof \WC_Product_Variable) {
            foreach ($product->get_children() as $childId) {
                $child = \wc_get_product($childId);
                if (!$child instanceof \WC_Product_Variation) {
                    continue;
                }
                $values = [];
                foreach ((array) $child->get_attributes() as $name => $value) {
                    $label = \wc_attribute_label((string) $name, $product);
                    $values[$label] = $this->optionLabel((string) $name, (string) $value);
                }
                $etsyProductId = $child->get_meta('_kcpw_etsy_product_id', true);
                $variations[] = new WooVariation(
                    (int) $child->get_id(),
                    (string) $child->get_sku(),
                    $values,
                    Text::cents((string) $child->get_price()),
                    (string) $child->get_status(),
                    (string) $child->get_stock_status(),
                    is_numeric($etsyProductId) ? (int) $etsyProductId : null,
                );
            }
        }
        $terms = \wp_get_post_terms($product->get_id(), 'product_cat', ['fields' => 'names']);
        $listingMeta = $product->get_meta('_kcpw_etsy_listing_id', true);
        $modified = $product->get_date_modified();
        return new WooProduct(
            (int) $product->get_id(),
            (string) $product->get_type(),
            (string) $product->get_status(),
            trim((string) $product->get_name()),
            (string) $product->get_slug(),
            (string) $product->get_sku(),
            (string) $product->get_description(),
            Text::cents((string) $product->get_price()),
            Text::cents((string) $product->get_regular_price()),
            $filenames,
            \is_wp_error($terms) ? [] : array_map('strval', (array) $terms),
            $attributes,
            $variations,
            is_numeric($listingMeta) ? (int) $listingMeta : null,
            $modified ? (string) $modified->date('c') : '',
            (bool) $product->get_manage_stock(),
        );
    }

    /** A taxonomy attribute stores a term slug; show its name. Custom attributes store the text itself. */
    private function optionLabel(string $attribute, string $value): string
    {
        if ($value !== '' && \taxonomy_exists($attribute)) {
            $term = \get_term_by('slug', $value, $attribute);
            if ($term instanceof \WP_Term) {
                return (string) $term->name;
            }
        }
        return $value;
    }
}
