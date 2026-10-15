<?php
declare(strict_types=1);

namespace KcPrintworks\Quotes\Wp;

use KcPrintworks\Quotes\Domain\Quote;
use KcPrintworks\Quotes\Service\OrderFacts;
use KcPrintworks\Quotes\Service\OrderFailed;
use KcPrintworks\Quotes\Service\OrderGateway;
use KcPrintworks\Quotes\Service\OrderRef;
use KcPrintworks\Quotes\Support\Money;

/**
 * WooCommerce orders, through WooCommerce's own order objects only (wc_create_order, wc_get_order, wc_get_orders and the order's own
 * setters/getters), which work the same with custom order tables (HPOS) on or off. Nothing here touches WooCommerce's tables, the
 * checkout page, a payment gateway or a cart; the customer pays on WooCommerce's normal "Pay for order" page, with whatever payment
 * methods the shop has switched on (Stripe).
 */
final class WcOrderGateway implements OrderGateway
{
    public const META_QUOTE_ID = '_kcpw_quote_id';
    public const META_REF = '_kcpw_quote_ref';
    public const META_FINGERPRINT = '_kcpw_quote_fp';
    public const META_CLOSED = '_kcpw_quote_closed';
    public const CREATED_VIA = 'kcpw-quotes';

    public function currency(): string
    {
        return (string) get_woocommerce_currency();
    }

    public function decimals(): int
    {
        return (int) wc_get_price_decimals();
    }

    public function createPendingOrder(Quote $quote, array $address, string $fingerprint): OrderRef
    {
        if (!function_exists('wc_create_order')) {
            throw new OrderFailed('WooCommerce is not available.');
        }
        try {
            $order = wc_create_order(['status' => 'pending', 'created_via' => self::CREATED_VIA, 'customer_id' => 0, 'currency' => $quote->currency()]);
            if (is_wp_error($order) || !($order instanceof \WC_Order)) {
                throw new OrderFailed('WooCommerce could not create the order.');
            }
            $parts = preg_split('/\s+/', trim($quote->name()), 2) ?: [''];
            $first = $parts[0] !== '' ? $parts[0] : 'Customer';
            $last = $parts[1] ?? '';
            $order->set_billing_first_name($first);
            $order->set_billing_last_name($last);
            $order->set_billing_email($quote->email());
            $order->set_billing_phone($address['phone']);
            $order->set_billing_address_1($address['line1']);
            $order->set_billing_address_2($address['line2']);
            $order->set_billing_city($address['city']);
            $order->set_billing_state($address['state']);
            $order->set_billing_postcode($address['postcode']);
            $order->set_billing_country($address['country']);
            $order->set_shipping_first_name($first);
            $order->set_shipping_last_name($last);
            $order->set_shipping_address_1($address['line1']);
            $order->set_shipping_address_2($address['line2']);
            $order->set_shipping_city($address['city']);
            $order->set_shipping_state($address['state']);
            $order->set_shipping_postcode($address['postcode']);
            $order->set_shipping_country($address['country']);
            if (method_exists($order, 'set_shipping_phone')) {
                $order->set_shipping_phone($address['phone']);
            }

            $fee = new \WC_Order_Item_Fee();
            $fee->set_name('Custom order ' . $quote->ref() . ': ' . $quote->title());
            $fee->set_amount(Money::format($quote->itemCents(), 2));
            $fee->set_total(Money::format($quote->itemCents(), 2));
            $fee->set_tax_status($quote->taxable() ? 'taxable' : 'none');
            $order->add_item($fee);

            if ($quote->shipCents() > 0) {
                $shipping = new \WC_Order_Item_Shipping();
                $shipping->set_method_title('Shipping (as quoted)');
                $shipping->set_method_id('kcpw_quote');
                $shipping->set_total(Money::format($quote->shipCents(), 2));
                $order->add_item($shipping);
            }

            $order->update_meta_data(self::META_QUOTE_ID, (string) $quote->id());
            $order->update_meta_data(self::META_REF, $quote->ref());
            $order->update_meta_data(self::META_FINGERPRINT, $fingerprint);
            $order->calculate_totals($quote->taxable());
            $order->add_order_note('Made for custom quote ' . $quote->ref() . ' (revision ' . $quote->revision() . '). Please do not change the amounts or add items: the quote checks them when the payment arrives.');
            $order->save();
            $url = (string) $order->get_checkout_payment_url();
            if ($url === '') {
                throw new OrderFailed('WooCommerce gave no payment address.');
            }
            return new OrderRef((int) $order->get_id(), $url);
        } catch (OrderFailed $e) {
            throw $e;
        } catch (\Throwable $e) {
            throw new OrderFailed($e->getMessage(), 0, $e);
        }
    }

    public function findByQuote(int $quoteId): ?OrderRef
    {
        if (!function_exists('wc_get_orders')) {
            return null;
        }
        $ids = wc_get_orders([
            'limit' => 5,
            'return' => 'ids',
            'status' => ['pending', 'failed', 'on-hold', 'processing', 'completed'],
            'meta_query' => [['key' => self::META_QUOTE_ID, 'value' => (string) $quoteId]],
            'orderby' => 'ID',
            'order' => 'ASC',
        ]);
        foreach (is_array($ids) ? $ids : [] as $id) {
            $url = $this->payUrl((int) $id);
            return new OrderRef((int) $id, $url ?? '');
        }
        return null;
    }

    public function payUrl(int $orderId): ?string
    {
        $order = wc_get_order($orderId);
        if (!($order instanceof \WC_Order) || (int) $order->get_meta(self::META_QUOTE_ID) < 1) {
            return null;
        }
        // needs_payment() is also where OrderHooks refuses payment for a quote that is no longer approved.
        return $order->needs_payment() ? (string) $order->get_checkout_payment_url() : null;
    }

    public function cancelUnpaid(int $orderId, string $note): string
    {
        $order = wc_get_order($orderId);
        if (!($order instanceof \WC_Order)) {
            return 'missing';
        }
        $status = (string) $order->get_status();
        if (in_array($status, ['processing', 'completed', 'refunded', 'on-hold'], true)) {
            return 'paid';
        }
        if ($status === 'cancelled') {
            return 'already_cancelled';
        }
        if (!in_array($status, ['pending', 'failed'], true)) {
            return 'failed';
        }
        try {
            // Written first, so the "order cancelled" notice this causes knows it was us and does not cancel the quote.
            $order->update_meta_data(self::META_CLOSED, 'plugin');
            $order->save();
            $order->update_status('cancelled', $note);
        } catch (\Throwable) {
            return 'failed';
        }
        $after = wc_get_order($orderId);
        return $after instanceof \WC_Order && (string) $after->get_status() === 'cancelled' ? 'cancelled' : 'failed';
    }

    public function inspect(int $orderId): ?OrderFacts
    {
        $order = wc_get_order($orderId);
        if (!($order instanceof \WC_Order)) {
            return null;
        }
        $quoteId = (int) $order->get_meta(self::META_QUOTE_ID);
        $fees = $order->get_items('fee');
        $shipping = $order->get_items('shipping');
        $feeCents = 0;
        foreach ($fees as $item) {
            $feeCents += self::cents((string) $item->get_total());
        }
        $shipCents = 0;
        foreach ($shipping as $item) {
            $shipCents += self::cents((string) $item->get_total());
        }
        $other = count($order->get_items('line_item')) + count($order->get_items('coupon')) + max(0, count($fees) - 1) + max(0, count($shipping) - 1);
        return new OrderFacts(
            $orderId,
            (string) $order->get_status(),
            strtoupper((string) $order->get_currency()),
            $feeCents,
            $shipCents,
            self::cents((string) $order->get_total_tax()),
            self::cents((string) $order->get_total()),
            $other,
            $quoteId,
            (string) $order->get_meta(self::META_FINGERPRINT),
            (string) $order->get_meta(self::META_CLOSED) === 'plugin',
        );
    }

    public function note(int $orderId, string $text): void
    {
        $order = wc_get_order($orderId);
        if ($order instanceof \WC_Order) {
            $order->add_order_note($text);
        }
    }

    public function adminUrl(int $orderId): string
    {
        $order = wc_get_order($orderId);
        return $order instanceof \WC_Order ? (string) $order->get_edit_order_url() : '';
    }

    /** "12.50" or "-3.00" -> cents, by string arithmetic (anything unreadable counts as an impossible amount, so it never matches). */
    public static function cents(string $amount): int
    {
        $amount = trim($amount);
        $negative = str_starts_with($amount, '-');
        $parsed = Money::parse(ltrim($amount, '-'), 2);
        if ($parsed === null) {
            return intdiv(PHP_INT_MIN, 4);
        }
        return $negative ? -$parsed : $parsed;
    }
}
