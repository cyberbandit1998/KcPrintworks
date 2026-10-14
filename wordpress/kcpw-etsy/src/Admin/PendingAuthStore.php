<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Admin;

/** Short-lived, single-use storage of the OAuth state and PKCE verifier between "Connect" and Etsy's redirect back. */
interface PendingAuthStore
{
    public function put(string $state, string $codeVerifier, string $userLabel): void;

    /** Returns and removes the entry; null when unknown, used, or older than ten minutes. */
    public function take(string $state): ?array;
}
