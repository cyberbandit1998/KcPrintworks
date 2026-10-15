<?php
declare(strict_types=1);

namespace KcPrintworks\Quotes\Domain;

/**
 * A keyed fingerprint of what a customer approved: quote, revision, the two amounts, currency, tax treatment and the customer's email.
 * It is written on the WooCommerce order when the order is made and checked again when a payment arrives, so an order that was edited
 * afterwards (a different total, a different quote) is never counted as the payment for the quote. The key is derived from the shared
 * secret with a purpose label, so it is not the same value that signs requests.
 */
final class Fingerprint
{
    public static function of(string $secret, int $quoteId, int $revision, int $itemCents, int $shipCents, string $currency, bool $taxable, string $email): string
    {
        $key = hash_hmac('sha256', 'kcpw-quotes/fingerprint', $secret);
        $data = implode("\n", ['KCQF1', $quoteId, $revision, $itemCents, $shipCents, strtoupper($currency), $taxable ? 'tax' : 'notax', strtolower($email)]);
        return hash_hmac('sha256', $data, $key);
    }

    public static function ofQuote(string $secret, Quote $quote): string
    {
        return self::of($secret, $quote->id(), $quote->revision(), $quote->itemCents(), $quote->shipCents(), $quote->currency(), $quote->taxable(), $quote->email());
    }
}
