<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Wp;

use KcPrintworks\Etsy\Admin\PendingAuthStore;

/** OAuth state and PKCE verifier in a transient for ten minutes. The state is hashed in the key so it is not guessable from the DB. */
final class WpPendingAuthStore implements PendingAuthStore
{
    private const TTL = 600;

    public function put(string $state, string $codeVerifier, string $userLabel): void
    {
        \set_transient($this->key($state), ['verifier' => $codeVerifier, 'user' => $userLabel, 'created' => time()], self::TTL);
    }

    public function take(string $state): ?array
    {
        $key = $this->key($state);
        $entry = \get_transient($key);
        \delete_transient($key);
        return is_array($entry) && isset($entry['verifier'], $entry['user']) ? $entry : null;
    }

    private function key(string $state): string
    {
        return 'kcpw_etsy_oauth_' . substr(hash('sha256', $state), 0, 40);
    }
}
