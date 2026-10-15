<?php
declare(strict_types=1);

namespace KcPrintworks\Quotes\Service;

use KcPrintworks\Quotes\Domain\Quote;

/**
 * Everything the quote rules need from WooCommerce, and nothing more. The rules (this plugin's src outside Wp) never call WooCommerce:
 * WcOrderGateway does, behind this interface, and the tests use a fake that keeps orders in an array.
 */
interface OrderGateway
{
    /** The store's currency (a quote is only valid in it). */
    public function currency(): string;

    /** The store's price precision. Quotes are whole cents, so only 2 is supported. */
    public function decimals(): int;

    /**
     * Makes a pending order for an approved quote: one fee line (the item), one shipping line, the customer's details, the quote's id and
     * fingerprint on it. Never a product line, never a coupon, never a payment.
     *
     * @param array{line1:string,line2:string,city:string,state:string,postcode:string,country:string,phone:string} $address
     * @throws OrderFailed
     */
    public function createPendingOrder(Quote $quote, array $address, string $fingerprint): OrderRef;

    /** An order that already carries this quote's id (so a crash between "order made" and "order saved on the quote" cannot make a second one). */
    public function findByQuote(int $quoteId): ?OrderRef;

    /** The address that pays this order, or null when the order can no longer be paid (paid, cancelled, missing). */
    public function payUrl(int $orderId): ?string;

    /** @return string 'cancelled' | 'already_cancelled' | 'paid' (do not touch) | 'missing' | 'failed' */
    public function cancelUnpaid(int $orderId, string $note): string;

    public function inspect(int $orderId): ?OrderFacts;

    public function note(int $orderId, string $text): void;

    /** The order's page in the dashboard (HPOS or not), or ''. */
    public function adminUrl(int $orderId): string;
}
