<?php
declare(strict_types=1);

namespace KcPrintworks\AddressAutocomplete;

/**
 * Recognizes post office boxes and US military mail addresses in a line of an address, so a shop that cannot deliver to them can say
 * so before the customer pays. Pure PHP; the same rules are written in assets/js/kcpw-aa-pobox.js and both are tested against
 * tests/vectors/pobox.json, so they cannot drift apart.
 *
 * It is a warning aid, not a guarantee: addresses can be written in ways no list foresees. It looks only at the text it is given.
 */
final class PoBox
{
    public const PO_BOX = 'po_box';
    public const MILITARY = 'military';

    /**
     * The text is lower-cased, accents removed, dots and other punctuation turned into spaces and spaces collapsed, so "P.O. Box 12",
     * "p o box 12" and "PO BOX 12" all read the same.
     */
    public static function normalize(string $text): string
    {
        $text = trim($text);
        $text = function_exists('mb_strtolower') ? mb_strtolower($text, 'UTF-8') : strtolower($text);
        $text = strtr($text, ['é' => 'e', 'è' => 'e', 'ê' => 'e', 'î' => 'i', 'ï' => 'i', 'ô' => 'o', 'ç' => 'c', 'ã' => 'a', 'á' => 'a', 'à' => 'a', 'ñ' => 'n', 'ü' => 'u', 'ö' => 'o', 'ä' => 'a']);
        // An accent typed as a letter plus a separate combining mark ("i" then U+0302) reads as the plain letter.
        $text = (string) (preg_replace('/[\x{0300}-\x{036f}]/u', '', $text) ?? $text);
        $text = (string) preg_replace('/[^a-z0-9]+/', ' ', $text);
        return trim((string) preg_replace('/\s+/', ' ', $text));
    }

    /** @return string|null self::PO_BOX, self::MILITARY, or null for an ordinary address */
    public static function detect(string $text): ?string
    {
        $t = ' ' . self::normalize($text) . ' ';
        if ($t === '  ') {
            return null;
        }
        // Military mail: an APO/FPO/DPO destination written the way the Post Office asks (with its AA/AE/AP code or a 09xxx zip), or a
        // PSC / CMR unit address.
        if (preg_match('/ (?:apo|fpo|dpo) (?:a[aep]\b|\d{5}\b)/', $t) === 1
            || preg_match('/ (?:apo|fpo|dpo) [a-z ]{0,20}\b09\d{3}\b/', $t) === 1
            || preg_match('/ (?:psc|cmr) \d+ /', $t) === 1
            || preg_match('/ (?:apo|fpo|dpo) a[aep] /', $t) === 1) {
            return self::MILITARY;
        }
        $boxes = [
            ' p o box ', ' po box ', ' pobox ', ' post office box ', ' postal box ', ' gpo box ', ' p o b ', ' pob ',
            ' private bag ', ' locked bag ', ' postfach ', ' apartado postal ', ' apartado de correos ', ' caixa postal ',
            ' boite postale ', ' casella postale ', ' postbus ',
        ];
        foreach ($boxes as $needle) {
            if (str_contains($t, $needle)) {
                // "p o b" and "pob" alone could also be the start of a name; they only count when a number follows.
                if (($needle === ' p o b ' || $needle === ' pob ') && preg_match('/ (?:p o b|pob) \d/', $t) !== 1) {
                    continue;
                }
                // Real boxes carry a number or a letter-number code: "Private Bag X15", "Postfach 12 34". A bare "Postfachweg" never gets here.
                return self::PO_BOX;
            }
        }
        return null;
    }

    /**
     * The first kind found in any of the lines.
     *
     * @param list<string> $lines
     */
    public static function detectAny(array $lines): ?string
    {
        foreach ($lines as $line) {
            $found = self::detect((string) $line);
            if ($found !== null) {
                return $found;
            }
        }
        return null;
    }
}
