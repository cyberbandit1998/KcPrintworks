<?php
declare(strict_types=1);

namespace KcPrintworks\Quotes\Service;

/** What a WooCommerce order actually says right now, reduced to what the payment check compares with the quote. Amounts in cents. */
final class OrderFacts
{
    public function __construct(
        public readonly int $orderId,
        public readonly string $status,
        public readonly string $currency,
        /** Sum of the order's fee lines (the quoted item amount is one fee line). */
        public readonly int $feeCents,
        public readonly int $shippingCents,
        public readonly int $taxCents,
        public readonly int $totalCents,
        /** Lines that are neither the quote's fee nor its shipping (a product someone added by hand, a second fee, a coupon). */
        public readonly int $otherLines,
        /** The quote id written on the order when it was made (0 for an ordinary order). */
        public readonly int $quoteId,
        public readonly string $fingerprint,
        /** The plugin itself cancelled this order (a revised or expired quote): the cancellation is not news and changes nothing. */
        public readonly bool $closedByPlugin = false,
        /** The gateway the customer used (WooCommerce's payment method id) and the gateway's own reference for the payment. */
        public readonly string $paymentMethod = '',
        public readonly string $transactionId = '',
    ) {
    }
}
