<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Wp;

use KcPrintworks\Etsy\Oauth\TokenSet;
use KcPrintworks\Etsy\Oauth\TokenStore;
use KcPrintworks\Etsy\Vault\TokenVault;

/** The one grant, encrypted at rest in a non-autoloaded option. An unreadable value is treated as "not connected". */
final class WpTokenStore implements TokenStore
{
    public const OPTION = 'kcpw_etsy_tokens';

    public function load(): ?TokenSet
    {
        $stored = \get_option(self::OPTION, '');
        if (!is_string($stored) || $stored === '') {
            return null;
        }
        try {
            $json = TokenVault::decrypt($stored, Config::encryptionKey());
            $data = $json === null ? null : json_decode($json, true);
            return is_array($data) ? TokenSet::fromArray($data) : null;
        } catch (\Throwable) {
            return null;
        }
    }

    public function save(TokenSet $tokens): void
    {
        $encrypted = TokenVault::encrypt((string) \wp_json_encode($tokens->toArray()), Config::encryptionKey());
        \update_option(self::OPTION, $encrypted, false);
    }

    public function clear(): void
    {
        \delete_option(self::OPTION);
    }
}
