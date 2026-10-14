<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Admin;

/** HTML escaping and small builders. Every value that reaches a page goes through e() or url(). */
final class Html
{
    public static function e(mixed $value): string
    {
        return htmlspecialchars((string) $value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    }

    /** Only http(s) URLs may become links; anything else (javascript:, data:) is dropped. */
    public static function url(string $url): string
    {
        return preg_match('#^https?://#i', $url) === 1 ? self::e($url) : '';
    }

    /** @param array<string,string|int> $attributes */
    public static function attrs(array $attributes): string
    {
        $out = '';
        foreach ($attributes as $name => $value) {
            $out .= ' ' . self::e($name) . '="' . self::e($value) . '"';
        }
        return $out;
    }
}
