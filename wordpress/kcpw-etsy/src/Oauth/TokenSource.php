<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Oauth;

/**
 * Hands out a valid access token and refreshes it when needed.
 *
 * Refresh tokens may rotate, so the new set is PERSISTED before the new access token is returned: if the process
 * dies right after Etsy issued new tokens, the stored set is already the new one and the old refresh token is
 * never reused. A rejected grant (`NeedsReauth`) is recorded and rethrown; callers must not loop on it.
 */
final class TokenSource
{
    private const REFRESH_MARGIN = 300; // seconds before expiry

    /** @param callable():int $clock */
    public function __construct(
        private readonly TokenStore $store,
        private readonly OAuthClient $oauth,
        private readonly Lock $lock = new NullLock(),
        private $clock = null,
    ) {
        $this->clock = $clock ?? static fn (): int => time();
    }

    public function connected(): bool
    {
        return $this->store->load() !== null;
    }

    public function accessToken(): string
    {
        $tokens = $this->store->load();
        if ($tokens === null) {
            throw new NeedsReauth('Not connected to Etsy.');
        }
        if ($tokens->expiresWithin(self::REFRESH_MARGIN, ($this->clock)())) {
            $tokens = $this->refresh($tokens);
        }
        return $tokens->accessToken;
    }

    /** Used after a 401: refresh once even if the clock says the token is still fresh. */
    public function forceRefresh(): string
    {
        $tokens = $this->store->load();
        if ($tokens === null) {
            throw new NeedsReauth('Not connected to Etsy.');
        }
        return $this->refresh($tokens, true)->accessToken;
    }

    private function refresh(TokenSet $stale, bool $force = false): TokenSet
    {
        /** @var TokenSet $fresh */
        $fresh = $this->lock->synchronized('etsy-token-refresh', function () use ($stale, $force): TokenSet {
            // Another job may have refreshed while we waited for the lock.
            $latest = $this->store->load() ?? $stale;
            $changed = $latest->refreshToken !== $stale->refreshToken;
            if ($changed || (!$force && !$latest->expiresWithin(self::REFRESH_MARGIN, ($this->clock)()))) {
                return $latest;
            }
            $new = $this->oauth->refresh($latest);
            $this->store->save($new); // persist BEFORE anyone uses the new access token
            return $new;
        });
        return $fresh;
    }
}
