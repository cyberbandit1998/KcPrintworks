<?php
declare(strict_types=1);

namespace KcPrintworks\Quotes\Domain;

/**
 * The number a customer quotes when they write to us: KCQ-YYMM-XXXXXX. The six characters are random (so numbers cannot be guessed or
 * counted), from an alphabet without I, O, 0 and 1 so they are easy to read out. The storefront has the same pattern (QUOTE_REF).
 */
final class Reference
{
    public const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    public const PATTERN = '/^KCQ-\d{4}-[A-HJ-NP-Z2-9]{6}$/D';

    public static function generate(int $now): string
    {
        $code = '';
        for ($i = 0; $i < 6; $i++) {
            $code .= self::ALPHABET[random_int(0, strlen(self::ALPHABET) - 1)];
        }
        return 'KCQ-' . gmdate('ym', $now) . '-' . $code;
    }

    public static function valid(string $ref): bool
    {
        return preg_match(self::PATTERN, $ref) === 1;
    }
}
