<?php
declare(strict_types=1);

namespace KcPrintworks\AddressAutocomplete;

/**
 * A fixed-window counter: "at most N hits per key per window". Pure PHP; the caller supplies where the counts live (the WordPress
 * layer passes transients), so the rule can be tested without WordPress.
 */
final class RateLimiter
{
    /**
     * @param callable(string): mixed          $get   returns the stored `[count, windowStart]` pair or something falsy
     * @param callable(string, array, int): void $set stores the pair for at most `$ttl` seconds
     * @return bool true when this hit is allowed, false when the limit is exhausted
     */
    public static function hit(callable $get, callable $set, string $key, int $limit, int $window, int $now): bool
    {
        $stored = $get($key);
        $count = 0;
        $start = $now;
        if (is_array($stored) && isset($stored[0], $stored[1]) && is_int($stored[0]) && is_int($stored[1]) && $now - $stored[1] < $window) {
            $count = $stored[0];
            $start = $stored[1];
        }
        if ($count >= $limit) {
            return false;
        }
        $set($key, [$count + 1, $start], max(1, $window - ($now - $start)));
        return true;
    }
}
