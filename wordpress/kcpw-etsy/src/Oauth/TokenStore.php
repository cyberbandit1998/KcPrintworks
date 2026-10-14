<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Oauth;

/** Persistence for the one connected grant. The WordPress implementation encrypts at rest. */
interface TokenStore
{
    public function load(): ?TokenSet;

    public function save(TokenSet $tokens): void;

    public function clear(): void;
}
