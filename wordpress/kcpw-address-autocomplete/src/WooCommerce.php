<?php
declare(strict_types=1);

namespace KcPrintworks\AddressAutocomplete;

/**
 * The only places this plugin reads WooCommerce on the server, both off by default and both guarded so that a fault here can never
 * stop an order that has nothing wrong with it:
 *
 *  - PO box enforcement. Only when the PO box module is on, set to "block" AND the plugin is Live (never in Preview: customers are
 *    not part of a preview). Blocks only a PO box, never a military address (APO/FPO addresses are real destinations for many shops).
 *    It checks the shipping address on the classic checkout and on the Checkout Block's Store API.
 *  - Counting finished orders, only when the owner opted in to checkout counting. A number goes up by one; no order, name or address
 *    is read or stored (a short-lived marker keyed by the order number stops a refreshed thank-you page counting twice).
 *
 * Nothing is written to an order, a customer or a product.
 */
final class WooCommerce
{
    /** @param array<string, mixed> $settings */
    public function __construct(private readonly array $settings)
    {
    }

    public function register(): void
    {
        add_action('woocommerce_thankyou', [$this, 'completed'], 10, 1);
        add_action('woocommerce_after_checkout_validation', [$this, 'classicValidation'], 10, 2);
        add_action('woocommerce_store_api_checkout_update_order_from_request', [$this, 'storeApi'], 10, 2);
    }

    public function enforcing(): bool
    {
        return ($this->settings['modules']['pobox'] ?? false) === true
            && ($this->settings['pobox_mode'] ?? 'warn') === 'block'
            && ($this->settings['mode'] ?? '') === Settings::MODE_LIVE;
    }

    public function completed(mixed $orderId): void
    {
        if (!Settings::optInEnabled($this->settings, 'abandonment') || ($this->settings['mode'] ?? '') !== Settings::MODE_LIVE) {
            return;
        }
        $id = is_numeric($orderId) ? (int) $orderId : 0;
        if ($id <= 0 || get_transient('kcpw_aa_cc_' . $id) !== false) {
            return;
        }
        set_transient('kcpw_aa_cc_' . $id, 1, 30 * DAY_IN_SECONDS);
        update_option(Usage::OPTION, Usage::bump(get_option(Usage::OPTION, []), ['cc' => 1], gmdate('Y-m-d')), false);
    }

    /** @param mixed $data the posted checkout fields @param mixed $errors a WP_Error */
    public function classicValidation(mixed $data, mixed $errors): void
    {
        try {
            if (!$this->enforcing() || !is_array($data) || !is_object($errors) || !method_exists($errors, 'add') || !$this->cartNeedsShipping()) {
                return;
            }
            $prefix = !empty($data['ship_to_different_address']) ? 'shipping_' : 'billing_';
            $found = PoBox::detectAny([(string) ($data[$prefix . 'address_1'] ?? ''), (string) ($data[$prefix . 'address_2'] ?? '')]);
            if ($found === PoBox::PO_BOX) {
                $errors->add('kcpw_aa_pobox', self::message());
            }
        } catch (\Throwable) {
            // Whatever goes wrong in a check must not stop an order.
        }
    }

    /** @param mixed $order a WC_Order @param mixed $request */
    public function storeApi(mixed $order, mixed $request): void
    {
        if (!$this->enforcing() || !is_object($order) || !method_exists($order, 'get_shipping_address_1')) {
            return;
        }
        try {
            $found = PoBox::detectAny([(string) $order->get_shipping_address_1(), (string) $order->get_shipping_address_2()]);
        } catch (\Throwable) {
            return;
        }
        $exception = '\Automattic\WooCommerce\StoreApi\Exceptions\RouteException';
        if ($found === PoBox::PO_BOX && class_exists($exception)) {
            throw new $exception('kcpw_aa_pobox', self::message(), 400);
        }
    }

    public static function message(): string
    {
        return __('Sorry, we cannot deliver to a PO box. Please enter a street address.', 'kcpw-address-autocomplete');
    }

    private function cartNeedsShipping(): bool
    {
        if (!function_exists('WC')) {
            return true;
        }
        $woo = \WC();
        return !is_object($woo) || !isset($woo->cart) || !is_object($woo->cart) || !method_exists($woo->cart, 'needs_shipping') || $woo->cart->needs_shipping();
    }
}
