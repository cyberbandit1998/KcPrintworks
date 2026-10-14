<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Wp;

use KcPrintworks\Etsy\Oauth\Lock;

/**
 * Single-flight lock built on add_option(), which fails atomically when the row exists. A lock older than 30 seconds is
 * considered abandoned (a crashed request) and taken over.
 */
final class WpOptionLock implements Lock
{
    private const TTL = 30;

    public function synchronized(string $name, callable $work): mixed
    {
        $key = 'kcpw_etsy_lock_' . preg_replace('/[^a-z0-9_]/', '', strtolower($name));
        $deadline = microtime(true) + 10;
        while (!\add_option($key, time() + self::TTL, '', false)) {
            $expires = (int) \get_option($key, 0);
            if ($expires > 0 && $expires < time()) {
                \delete_option($key);
                continue;
            }
            if (microtime(true) > $deadline) {
                throw new \RuntimeException('Another request is refreshing the Etsy token. Try again in a moment.');
            }
            usleep(200_000);
        }
        try {
            return $work();
        } finally {
            \delete_option($key);
        }
    }
}
