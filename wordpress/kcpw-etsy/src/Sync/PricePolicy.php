<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Sync;

/**
 * Website price from the Etsy price. All math is integer cents, rounded half away from zero.
 *  etsy           website price equals the Etsy price (default: Etsy is the master for base prices)
 *  markup_percent website price = Etsy price + basis points (100 bp = 1 percent)
 *  fixed_delta    website price = Etsy price + a fixed number of cents (may be negative)
 *  fixed          website price is a price the owner set; Etsy changes do not move it
 */
final class PricePolicy
{
    public const ETSY = 'etsy';
    public const MARKUP_PERCENT = 'markup_percent';
    public const FIXED_DELTA = 'fixed_delta';
    public const FIXED = 'fixed';

    public function __construct(
        public readonly string $type = self::ETSY,
        public readonly int $value = 0,
    ) {
        if (!in_array($type, [self::ETSY, self::MARKUP_PERCENT, self::FIXED_DELTA, self::FIXED], true)) {
            throw new \InvalidArgumentException('Unknown price policy: ' . $type);
        }
        if ($type === self::FIXED && $value < 0) {
            throw new \InvalidArgumentException('A fixed price cannot be negative.');
        }
    }

    public function websitePriceCents(int $etsyCents): int
    {
        $price = match ($this->type) {
            self::ETSY => $etsyCents,
            self::MARKUP_PERCENT => $etsyCents + self::percentOf($etsyCents, $this->value),
            self::FIXED_DELTA => $etsyCents + $this->value,
            self::FIXED => $this->value,
        };
        return max(0, $price);
    }

    public function describe(): string
    {
        return match ($this->type) {
            self::ETSY => 'same as Etsy',
            self::MARKUP_PERCENT => sprintf('Etsy %s%s%%', $this->value >= 0 ? '+' : '-', number_format(abs($this->value) / 100, 2)),
            self::FIXED_DELTA => sprintf('Etsy %s$%s', $this->value >= 0 ? '+' : '-', number_format(abs($this->value) / 100, 2)),
            self::FIXED => sprintf('fixed $%s', number_format($this->value / 100, 2)),
        };
    }

    private static function percentOf(int $cents, int $basisPoints): int
    {
        $numerator = $cents * $basisPoints;
        $sign = $numerator < 0 ? -1 : 1;
        return $sign * intdiv(abs($numerator) * 2 + 10_000, 20_000);
    }
}
