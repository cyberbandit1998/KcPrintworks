<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Model;

/**
 * An amount as Etsy reports it: integer `amount` with a `divisor` (To verify: 100 for USD) and a currency code.
 * All arithmetic is integer based; there is no floating point anywhere in price handling.
 */
final class Money
{
    public function __construct(
        public readonly int $amount,
        public readonly int $divisor,
        public readonly string $currency,
    ) {
        if ($divisor < 1) {
            throw new \InvalidArgumentException('Money divisor must be positive.');
        }
    }

    /** @param array<string,mixed> $data {amount, divisor, currency_code} */
    public static function fromEtsy(array $data): ?self
    {
        if (!isset($data['amount'], $data['divisor']) || !is_numeric($data['amount']) || !is_numeric($data['divisor']) || (int) $data['divisor'] < 1) {
            return null;
        }
        return new self((int) $data['amount'], (int) $data['divisor'], (string) ($data['currency_code'] ?? ''));
    }

    /** Minor units for a 2-decimal currency (cents), rounding half away from zero with integer math. */
    public function toCents(): int
    {
        $numerator = $this->amount * 100;
        $sign = $numerator < 0 ? -1 : 1;
        return $sign * intdiv(abs($numerator) * 2 + $this->divisor, 2 * $this->divisor);
    }
}
