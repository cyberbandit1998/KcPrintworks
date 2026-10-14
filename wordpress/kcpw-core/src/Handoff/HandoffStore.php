<?php
declare(strict_types=1);

namespace KcPrintworks\Core\Handoff;

/** Server-side storage for pending handoffs. The token itself is never stored, only its hash. */
interface HandoffStore
{
    public function put(string $tokenHash, string $payloadJson, int $expiresAt): void;

    /** Returns the payload exactly once (it is deleted), or null if unknown, expired, or already taken. Must be atomic. */
    public function take(string $tokenHash, int $now): ?string;
}
