<?php
declare(strict_types=1);

namespace KcPrintworks\Core\Support;

/**
 * The storefront's slug function (`sanitizeTitle` in apps/storefront/src/lib/catalog/export/text.ts), so an attribute
 * option the shopper picked on the storefront is recognised here whatever WordPress's own sanitize_title would make of it.
 */
final class Slug
{
    private const ENTITIES = [
        'amp' => '&', 'lt' => '<', 'gt' => '>', 'quot' => '"', 'apos' => "'", 'nbsp' => ' ',
        'rsquo' => "\u{2019}", 'lsquo' => "\u{2018}", 'ndash' => "\u{2013}", 'mdash' => "\u{2014}",
    ];

    public static function decodeEntities(string $value): string
    {
        return (string) preg_replace_callback(
            '/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/i',
            static function (array $m): string {
                if (($m[1] ?? '') !== '') {
                    return self::codePoint((int) $m[1]) ?? $m[0];
                }
                if (($m[2] ?? '') !== '') {
                    return self::codePoint((int) hexdec($m[2])) ?? $m[0];
                }
                return self::ENTITIES[strtolower($m[3] ?? '')] ?? $m[0];
            },
            $value,
        );
    }

    private static function codePoint(int $code): ?string
    {
        if ($code < 0 || $code > 0x10FFFF || ($code >= 0xD800 && $code <= 0xDFFF)) {
            return null;
        }
        return mb_chr($code, 'UTF-8') ?: null;
    }

    public static function of(string $value): string
    {
        $text = self::decodeEntities($value);
        if (class_exists(\Normalizer::class)) {
            $normalized = \Normalizer::normalize($text, \Normalizer::FORM_KD);
            $text = $normalized === false ? $text : $normalized;
        }
        $text = (string) preg_replace('/[\x{0300}-\x{036F}]/u', '', $text);
        $text = mb_strtolower($text, 'UTF-8');
        $text = str_replace('&', ' and ', $text);
        $text = (string) preg_replace('/[^a-z0-9]+/', '-', $text);
        return trim($text, '-');
    }

    /**
     * Unique slugs for a list of names, in order: a repeat gets "-2", "-3" (the storefront does the same, so both
     * sides agree on which option is which). A blank name becomes "option".
     *
     * @param list<string> $names
     * @return list<string>
     */
    public static function uniqueList(array $names): array
    {
        $taken = [];
        $out = [];
        foreach ($names as $name) {
            $base = self::of($name);
            $base = $base === '' ? 'option' : $base;
            $slug = $base;
            for ($n = 2; isset($taken[$slug]); $n++) {
                $slug = $base . '-' . $n;
            }
            $taken[$slug] = true;
            $out[] = $slug;
        }
        return $out;
    }
}
