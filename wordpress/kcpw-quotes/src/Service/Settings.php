<?php
declare(strict_types=1);

namespace KcPrintworks\Quotes\Service;

/** Everything the rules need to know about this site, in one plain object (built from wp-config.php constants by Wp\Config). */
final class Settings
{
    public function __construct(
        /** The shared secret (KCPW_HANDOFF_SECRET): signs requests and keys the order fingerprint. */
        public readonly string $secret,
        /** Where the storefront lives (KCPW_STOREFRONT_URL), no trailing slash; '' when not set (quotes cannot be sent). */
        public readonly string $storefrontUrl,
        public readonly string $notifyEmail = 'contact@kcprintworks.com',
        public readonly string $shopName = 'KCPrintWorks',
        public readonly string $timezone = 'America/Detroit',
        /** Charged with tax by WooCommerce on top of the quoted amounts (KCPW_QUOTES_TAXABLE). Off: the quoted total is the total. */
        public readonly bool $taxable = false,
        public readonly int $validDays = 14,
        /** How long after approving the customer has to pay before the unpaid order is cancelled and the quote expires. */
        public readonly int $payWindowSeconds = 72 * 3600,
        public readonly int $maxPerClientPerHour = 6,
        public readonly int $maxAllPerHour = 100,
        /**
         * Payment method ids (or their starts) that count as real money for a quote: the order's payment method must be one of these AND carry
         * the gateway's transaction id. Cash on delivery, bank transfer and cheque finish an order as "Processing" without taking any money, so
         * they are deliberately not here. Change with KCPW_QUOTES_PAYMENT_METHODS.
         *
         * @var list<string>
         */
        public readonly array $paymentMethods = ['stripe', 'ppcp', 'paypal', 'woocommerce_payments'],
    ) {
    }

    public function zone(): \DateTimeZone
    {
        try {
            return new \DateTimeZone($this->timezone);
        } catch (\Exception) {
            return new \DateTimeZone('UTC');
        }
    }

    /** Today's date in the shop's time zone, YYYY-MM-DD. */
    public function today(int $now): string
    {
        return (new \DateTimeImmutable('@' . $now))->setTimezone($this->zone())->format('Y-m-d');
    }

    public function longDate(int $time): string
    {
        return (new \DateTimeImmutable('@' . $time))->setTimezone($this->zone())->format('F j, Y');
    }

    public function dateTime(int $time): string
    {
        return $time > 0 ? (new \DateTimeImmutable('@' . $time))->setTimezone($this->zone())->format('M j, Y g:i a') : '';
    }

    public function quoteLink(string $ref, string $token): string
    {
        return $this->storefrontUrl . '/custom-orders/quote/?ref=' . rawurlencode($ref) . '&token=' . rawurlencode($token);
    }
}
