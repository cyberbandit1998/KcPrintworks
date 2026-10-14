<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Tests;

use KcPrintworks\Etsy\Oauth\TokenSet;
use KcPrintworks\Etsy\Oauth\TokenStore;

final class MemoryTokenStore implements TokenStore
{
    public int $saves = 0;

    public function __construct(public ?TokenSet $tokens = null)
    {
    }

    public function load(): ?TokenSet
    {
        return $this->tokens;
    }

    public function save(TokenSet $tokens): void
    {
        $this->tokens = $tokens;
        $this->saves++;
    }

    public function clear(): void
    {
        $this->tokens = null;
    }
}
