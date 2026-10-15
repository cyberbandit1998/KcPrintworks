<?php
declare(strict_types=1);

namespace KcPrintworks\Quotes\Support;

/** JSON helpers. Objects decode to stdClass so "an object" and "a list" stay different things (PHP arrays blur them). */
final class Json
{
    /** @throws \JsonException */
    public static function decode(string $json): mixed
    {
        return json_decode($json, false, 32, JSON_THROW_ON_ERROR);
    }

    /** Objects (stdClass) to associative arrays, recursively. Lists stay lists. */
    public static function assoc(mixed $value): mixed
    {
        if ($value instanceof \stdClass) {
            $out = [];
            foreach (get_object_vars($value) as $key => $item) {
                $out[$key] = self::assoc($item);
            }
            return $out;
        }
        if (is_array($value)) {
            return array_map([self::class, 'assoc'], $value);
        }
        return $value;
    }

    public static function encode(mixed $value): string
    {
        return json_encode($value, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    }
}
