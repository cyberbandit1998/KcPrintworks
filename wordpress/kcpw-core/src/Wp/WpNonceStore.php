<?php
declare(strict_types=1);

namespace KcPrintworks\Core\Wp;

use KcPrintworks\Core\Auth\NonceStore;

/** Request nonces as short-lived transients. */
final class WpNonceStore implements NonceStore
{
    public function remember(string $nonce, int $ttlSeconds): bool
    {
        $key = 'kcpw_n_' . md5($nonce);
        if (get_transient($key) !== false) {
            return false;
        }
        set_transient($key, 1, $ttlSeconds);
        return true;
    }
}
