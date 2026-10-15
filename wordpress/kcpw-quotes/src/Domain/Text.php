<?php
declare(strict_types=1);

namespace KcPrintworks\Quotes\Domain;

/**
 * The text rules shared by the request and approval validators: exactly what packages/contracts/src/quote-logic.ts does (the TypeScript is
 * the reference; the shared vectors prove they agree). Pure PHP, no WordPress calls.
 */
final class Text
{
    /** Control, zero-width and bidi characters, written as escapes and never literally. Newline is handled separately. */
    private const FORBIDDEN = '/[\x{0000}-\x{0009}\x{000B}-\x{001F}\x{007F}-\x{009F}\x{200B}-\x{200F}\x{202A}-\x{202E}\x{2066}-\x{2069}\x{FEFF}]/u';

    /** What JavaScript's trim() removes. */
    public const SPACE = '[\x{0009}-\x{000D}\x{0020}\x{00A0}\x{1680}\x{2000}-\x{200A}\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}\x{FEFF}]';

    /** @return array{field:string,code:string,message:string} */
    public static function issue(string $field, string $code, string $message): array
    {
        return ['field' => $field, 'code' => $code, 'message' => $message];
    }

    public static function missing(mixed $value): bool
    {
        return $value === null || $value === '';
    }

    /** JSON numbers: 5 and 5.0 are the same whole number (as in JavaScript); text, booleans and fractions are not numbers here. */
    public static function wholeNumber(mixed $value): ?int
    {
        if (is_int($value)) {
            return $value;
        }
        if (is_float($value) && is_finite($value) && floor($value) === $value && abs($value) < 9.0e15) {
            return (int) $value;
        }
        return null;
    }

    /** NFC, line endings to "\n", trimmed like JavaScript. Null when the text is not valid UTF-8. */
    public static function normalize(string $raw): ?string
    {
        if (preg_match('//u', $raw) !== 1) {
            return null;
        }
        if (class_exists(\Normalizer::class)) {
            $nfc = \Normalizer::normalize($raw, \Normalizer::FORM_C);
            if ($nfc === false) {
                return null;
            }
            $raw = $nfc;
        }
        $raw = (string) preg_replace('/\r\n?/', "\n", $raw);
        return preg_replace('/^' . self::SPACE . '+|' . self::SPACE . '+$/u', '', $raw);
    }

    /** JavaScript's trim() only. */
    public static function trim(string $raw): string
    {
        return (string) preg_replace('/^' . self::SPACE . '+|' . self::SPACE . '+$/u', '', $raw);
    }

    /** Runs of whitespace (as JavaScript's trim() sees it) become one space. */
    public static function collapse(string $text): string
    {
        return (string) preg_replace('/' . self::SPACE . '+/u', ' ', $text);
    }

    public static function forbidden(string $text, bool $allowNewline): bool
    {
        if (!$allowNewline && str_contains($text, "\n")) {
            return true;
        }
        return preg_match(self::FORBIDDEN, $text) === 1;
    }

    /** Length in characters (code points), like JavaScript's Array.from(text).length. */
    public static function length(string $text): int
    {
        return mb_strlen($text, 'UTF-8');
    }
}
