<?php
declare(strict_types=1);

namespace KcPrintworks\Quotes\Wp;

use KcPrintworks\Quotes\Auth\NonceStore;

/** Request nonces as short-lived transients. */
final class WpNonceStore implements NonceStore
{
    public function remember(string $nonce, int $ttlSeconds): bool
    {
        $key = 'kcpwq_n_' . md5($nonce);
        if (get_transient($key) !== false) {
            return false;
        }
        set_transient($key, 1, $ttlSeconds);
        return true;
    }
}
