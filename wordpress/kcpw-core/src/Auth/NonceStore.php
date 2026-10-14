<?php
declare(strict_types=1);

namespace KcPrintworks\Core\Auth;

/** Remembers request nonces so a captured signed request cannot be replayed inside the time window. */
interface NonceStore
{
    /** True if the nonce was new (and is now remembered); false if it has been seen. */
    public function remember(string $nonce, int $ttlSeconds): bool;
}
