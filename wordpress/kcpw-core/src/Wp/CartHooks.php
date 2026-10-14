<?php
declare(strict_types=1);

namespace KcPrintworks\Core\Wp;

use KcPrintworks\Core\Options\OptionSchema;
use KcPrintworks\Core\Options\OptionValidator;
use KcPrintworks\Core\Support\Json;
use KcPrintworks\Core\Support\Money;

/**
 * How personalization lives in the WooCommerce cart and on the order. Every personalized line is validated again here,
 * from the product's own schema, no matter how it got into the cart.
 *
 * A cart line carries   $cart_item['kcpw'] = ['options' => [id => value], 'summary' => [[fieldId,label,value]], 'schemaVersion' => n]
 * Different options make WooCommerce treat lines as different (it hashes the cart item data), so two names never merge.
 */
final class CartHooks
{
    /** True only while the handoff is building the cart: the one place allowed to add a personalized product. */
    public static bool $building = false;

    public function register(): void
    {
        add_filter('woocommerce_add_to_cart_validation', [$this, 'refuseUnpersonalized'], 10, 3);
        add_filter('woocommerce_get_item_data', [$this, 'itemData'], 10, 2);
        add_action('woocommerce_before_calculate_totals', [$this, 'applyOptionCharges'], 20, 1);
        add_action('woocommerce_check_cart_items', [$this, 'recheckCart']);
        add_action('woocommerce_checkout_create_order_line_item', [$this, 'saveOnOrderItem'], 10, 4);
    }

    private function schemaFor(int $productId): ?OptionSchema
    {
        $product = wc_get_product($productId);
        if (!($product instanceof \WC_Product)) {
            return null;
        }
        $json = $product->get_meta(WcProductSource::META_SCHEMA, true);
        if (!is_string($json) || trim($json) === '') {
            return OptionSchema::empty();
        }
        try {
            return OptionSchema::fromJson($json);
        } catch (\Throwable $e) {
            return null;
        }
    }

    /** A product whose personalization has required fields cannot be added from anywhere but the validated handoff. */
    public function refuseUnpersonalized(mixed $passed, mixed $productId = 0, mixed $quantity = 1): bool
    {
        if (!$passed || self::$building) {
            return (bool) $passed;
        }
        $productId = (int) $productId;
        $schema = $this->schemaFor($productId);
        if ($schema === null || $schema->hasRequired()) {
            wc_add_notice(__('This item needs personalization. Please order it from the main shop.', 'kcpw-core'), 'error');
            return false;
        }
        return true;
    }

    /**
     * @param list<array<string,mixed>> $itemData
     * @param array<string,mixed> $cartItem
     * @return list<array<string,mixed>>
     */
    public function itemData(array $itemData, array $cartItem): array
    {
        foreach ($cartItem['kcpw']['summary'] ?? [] as $row) {
            $itemData[] = ['key' => (string) $row['label'], 'value' => (string) $row['value'], 'display' => esc_html((string) $row['value'])];
        }
        return $itemData;
    }

    /** Option charges are recomputed from the schema every time totals are calculated; nothing is trusted from the cart item. */
    public function applyOptionCharges(\WC_Cart $cart): void
    {
        if (is_admin() && !defined('DOING_AJAX')) {
            return;
        }
        $decimals = (int) wc_get_price_decimals();
        foreach ($cart->get_cart() as $item) {
            if (empty($item['kcpw']['options']) || !isset($item['data'])) {
                continue;
            }
            $schema = $this->schemaFor((int) $item['product_id']);
            $fresh = wc_get_product((int) ($item['variation_id'] ?: $item['product_id']));
            if ($schema === null || !($fresh instanceof \WC_Product)) {
                continue;
            }
            $base = Money::parse((string) $fresh->get_price('edit'), $decimals);
            if ($base === null) {
                continue;
            }
            $adders = OptionValidator::adders($schema, (array) $item['kcpw']['options'], $base);
            $item['data']->set_price(Money::format($base + $adders, $decimals));
        }
    }

    /** Runs on the cart and checkout pages: a line whose personalization no longer validates blocks checkout. */
    public function recheckCart(): void
    {
        if (!function_exists('WC') || WC()->cart === null) {
            return;
        }
        foreach (WC()->cart->get_cart() as $item) {
            $options = $item['kcpw']['options'] ?? null;
            $schema = $this->schemaFor((int) $item['product_id']);
            if ($schema === null) {
                wc_add_notice(__('An item in your cart is not available right now. Please remove it.', 'kcpw-core'), 'error');
                continue;
            }
            if ($options === null) {
                if ($schema->hasRequired()) {
                    wc_add_notice(__('An item in your cart is missing its personalization. Please remove it and order it again.', 'kcpw-core'), 'error');
                }
                continue;
            }
            $check = OptionValidator::validate($schema, (object) $options);
            if (!$check->ok) {
                wc_add_notice(__('The personalization on an item in your cart is no longer valid. Please remove it and order it again.', 'kcpw-core'), 'error');
            }
        }
    }

    /**
     * Readable lines on the order item (admin, emails, packing slips), plus one hidden record for automation.
     *
     * @param array<string,mixed> $values the cart item
     */
    public function saveOnOrderItem(\WC_Order_Item_Product $item, string $cartItemKey, array $values, \WC_Order $order): void
    {
        $kcpw = $values['kcpw'] ?? null;
        if (!is_array($kcpw) || empty($kcpw['summary'])) {
            return;
        }
        foreach ($kcpw['summary'] as $row) {
            $item->add_meta_data((string) $row['label'], (string) $row['value']);
        }
        $item->add_meta_data('_kcpw_personalization', Json::encode([
            'v' => 1,
            'schemaVersion' => (int) ($kcpw['schemaVersion'] ?? 1),
            'values' => (object) ($kcpw['options'] ?? []),
            'summary' => $kcpw['summary'],
        ]), true);
    }
}
