<?php
declare(strict_types=1);

namespace KcPrintworks\Quotes\Wp;

use KcPrintworks\Quotes\Domain\Fingerprint;
use KcPrintworks\Quotes\Domain\Status;
use KcPrintworks\Quotes\Repo\QuoteRepository;
use KcPrintworks\Quotes\Service\Payments;
use KcPrintworks\Quotes\Service\Settings;

/**
 * The few places where WooCommerce is told about quotes. Every hook starts by asking "does this order carry a quote's id?" and returns
 * at once if not, so ordinary orders and the normal checkout are not touched in any way.
 *
 *   - an order that becomes Processing/Completed is checked against its quote and the quote becomes Paid;
 *   - an order that is cancelled or refunded is reported to the quote;
 *   - WooCommerce's "cancel unpaid orders" housekeeping leaves quote orders to the quote's own payment window;
 *   - a quote order can only be PAID while its quote is Approved, in time, and unchanged.
 */
final class OrderHooks
{
    public function __construct(
        private readonly Payments $payments,
        private readonly QuoteRepository $repo,
        private readonly Settings $settings,
        private $clock = null,
    ) {
    }

    public function register(): void
    {
        add_action('woocommerce_order_status_changed', [$this, 'statusChanged'], 20, 4);
        add_filter('woocommerce_cancel_unpaid_order', [$this, 'keepUnpaidQuoteOrder'], 20, 2);
        add_filter('woocommerce_order_needs_payment', [$this, 'needsPayment'], 20, 3);
    }

    private static function quoteIdOf(mixed $order): int
    {
        return $order instanceof \WC_Order ? (int) $order->get_meta(WcOrderGateway::META_QUOTE_ID) : 0;
    }

    public function statusChanged(mixed $orderId, mixed $from, mixed $to, mixed $order = null): void
    {
        if (self::quoteIdOf($order) < 1) {
            return;
        }
        try {
            match ((string) $to) {
                'processing', 'completed' => $this->payments->onOrderPaid((int) $orderId),
                'cancelled' => $this->payments->onOrderCancelled((int) $orderId),
                'refunded' => $this->payments->onOrderRefunded((int) $orderId),
                default => null,
            };
        } catch (\Throwable $e) {
            // Never break WooCommerce's own work because of us: leave a trace for the owner and carry on.
            if (function_exists('error_log')) {
                error_log('[kcpw-quotes] order ' . (int) $orderId . ' status notice failed: ' . $e->getMessage());
            }
        }
    }

    public function keepUnpaidQuoteOrder(mixed $cancel, mixed $order = null): mixed
    {
        return self::quoteIdOf($order) > 0 ? false : $cancel;
    }

    public function needsPayment(mixed $needs, mixed $order = null, mixed $validStatuses = null): mixed
    {
        $quoteId = self::quoteIdOf($order);
        if ($quoteId < 1 || $needs !== true) {
            return $needs;
        }
        $quote = $this->repo->find($quoteId);
        $now = $this->clock !== null ? ($this->clock)() : time();
        if ($quote === null
            || $quote->status() !== Status::APPROVED
            || $quote->orderId() !== (int) $order->get_id()
            || $quote->payWindowOver($now)
            || !hash_equals(Fingerprint::ofQuote($this->settings->secret, $quote), (string) $order->get_meta(WcOrderGateway::META_FINGERPRINT))) {
            return false;
        }
        return true;
    }
}
