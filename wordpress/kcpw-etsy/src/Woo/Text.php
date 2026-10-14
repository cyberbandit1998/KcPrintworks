<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Woo;

/** Small text helpers shared by the readers, the matcher, and the planner. */
final class Text
{
    private const IMPORT_FOOTER = '/(?:<br\s*\/?>|\s)*Listed with ExportYourStore\.com\s*$/i';

    public static function decode(string $text): string
    {
        return html_entity_decode($text, ENT_QUOTES | ENT_HTML5, 'UTF-8');
    }

    /** Lowercase words only: for comparing titles regardless of punctuation, entities, and spacing. */
    public static function words(string $text): string
    {
        return trim((string) preg_replace('/[^\p{L}\p{N}]+/u', ' ', mb_strtolower(self::decode($text))));
    }

    /** Plain text of a description (tags, entities, literal "\n", and an import-tool footer removed). */
    public static function plain(string $html): string
    {
        $text = str_replace('\\n', ' ', $html);
        $text = (string) preg_replace(self::IMPORT_FOOTER, '', $text);
        $text = (string) preg_replace('/<br\s*\/?>/i', ' ', $text);
        $text = strip_tags($text);
        return trim((string) preg_replace('/\s+/u', ' ', self::decode($text)));
    }

    /** @return list<string> 3-word shingles of the normalized words */
    public static function shingles(string $text, int $size = 3): array
    {
        $words = explode(' ', self::words(self::plain($text)));
        if (count($words) < $size) {
            return $words === [''] ? [] : [implode(' ', $words)];
        }
        $out = [];
        for ($i = 0; $i <= count($words) - $size; $i++) {
            $out[implode(' ', array_slice($words, $i, $size))] = true;
        }
        return array_keys($out);
    }

    /** @param list<string> $a @param list<string> $b */
    public static function jaccard(array $a, array $b): float
    {
        if ($a === [] || $b === []) {
            return 0.0;
        }
        $intersection = count(array_intersect($a, $b));
        $union = count(array_unique(array_merge($a, $b)));
        return $union === 0 ? 0.0 : $intersection / $union;
    }

    /** "13.24" -> 1324 using string arithmetic only. Null when the text is not a price. */
    public static function cents(string $price): ?int
    {
        if (preg_match('/^\s*\$?\s*(\d{1,7})(?:\.(\d{1,2}))?\s*$/', str_replace(',', '', $price), $m) !== 1) {
            return null;
        }
        return (int) $m[1] * 100 + (int) str_pad($m[2] ?? '', 2, '0');
    }

    /** The Etsy image id inside a file name such as il_fullxfull.5123456789_abcd.jpg (To verify the pattern). */
    public static function etsyImageId(string $filename): ?int
    {
        return preg_match('/il_(?:fullxfull|\d+x(?:\d+|N))\.(\d+)_[a-z0-9]+/i', $filename, $m) === 1 ? (int) $m[1] : null;
    }

    /** @return list<string> digit runs of at least $min digits (candidate marketplace ids inside SKUs) */
    public static function longNumbers(string $text, int $min = 9): array
    {
        preg_match_all('/\d{' . $min . ',}/', $text, $m);
        return array_values(array_unique($m[0]));
    }
}
