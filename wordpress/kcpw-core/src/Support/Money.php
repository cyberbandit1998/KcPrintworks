<?php
declare(strict_types=1);

namespace KcPrintworks\Core\Support;

/** Money is whole minor units (cents). No floating point anywhere. Mirrors packages/contracts/src/money.ts. */
final class Money
{
    /** `basisPoints` of an amount (100 bp = 1%), rounded half away from zero to the minor unit. */
    public static function percentOf(int $amount, int $basisPoints): int
    {
        $numerator = $amount * $basisPoints;
        $sign = $numerator < 0 ? -1 : 1;
        return $sign * intdiv(abs($numerator) * 2 + 10_000, 20_000);
    }

    /**
     * "13.24" -> 1324 using string arithmetic (WooCommerce prices are decimal strings). Returns null when it is not a price.
     * `$decimals` is the store's price precision (2 for USD).
     */
    public static function parse(string $price, int $decimals = 2): ?int
    {
        $price = trim($price);
        if (!preg_match('/^(\d{1,9})(?:\.(\d+))?$/', $price, $m)) {
            return null;
        }
        $fraction = $m[2] ?? '';
        if (strlen($fraction) > $decimals) {
            // More precision than the currency has: round half away from zero on the first dropped digit.
            $round = (int) $fraction[$decimals] >= 5 ? 1 : 0;
            $fraction = substr($fraction, 0, $decimals);
        } else {
            $round = 0;
            $fraction = str_pad($fraction, $decimals, '0');
        }
        return ((int) $m[1]) * (10 ** $decimals) + (int) ($fraction === '' ? '0' : $fraction) + $round;
    }

    /** 1324 -> "13.24". Whole-number arithmetic; the result is the decimal string WooCommerce prices use. */
    public static function format(int $cents, int $decimals = 2): string
    {
        $sign = $cents < 0 ? '-' : '';
        $cents = abs($cents);
        if ($decimals === 0) {
            return $sign . $cents;
        }
        $unit = 10 ** $decimals;
        return $sign . intdiv($cents, $unit) . '.' . str_pad((string) ($cents % $unit), $decimals, '0', STR_PAD_LEFT);
    }
}
