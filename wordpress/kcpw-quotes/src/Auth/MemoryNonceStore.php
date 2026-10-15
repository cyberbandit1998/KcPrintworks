<?php
declare(strict_types=1);

namespace KcPrintworks\Quotes\Auth;

final class MemoryNonceStore implements NonceStore
{
    /** @var array<string,true> */
    private array $seen = [];

    public function remember(string $nonce, int $ttlSeconds): bool
    {
        if (isset($this->seen[$nonce])) {
            return false;
        }
        $this->seen[$nonce] = true;
        return true;
    }
}
