<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Oauth;

/** An Etsy OAuth grant. Never logged, never returned by any API, stored only encrypted (see Vault\TokenVault). */
final class TokenSet
{
    /** @param list<string> $scopes */
    public function __construct(
        public readonly string $accessToken,
        public readonly string $refreshToken,
        public readonly int $expiresAt,
        public readonly array $scopes,
        public readonly int $obtainedAt,
    ) {
    }

    /** Etsy access tokens begin with the numeric user id and a dot (To verify on the first real token). */
    public function userId(): ?int
    {
        return preg_match('/^(\d+)\./', $this->accessToken, $m) === 1 ? (int) $m[1] : null;
    }

    public function expiresWithin(int $seconds, int $now): bool
    {
        return $this->expiresAt - $now <= $seconds;
    }

    /** @return array<string,mixed> */
    public function toArray(): array
    {
        return [
            'access_token' => $this->accessToken,
            'refresh_token' => $this->refreshToken,
            'expires_at' => $this->expiresAt,
            'scopes' => $this->scopes,
            'obtained_at' => $this->obtainedAt,
        ];
    }

    /** @param array<string,mixed> $data */
    public static function fromArray(array $data): self
    {
        foreach (['access_token', 'refresh_token', 'expires_at', 'scopes', 'obtained_at'] as $key) {
            if (!array_key_exists($key, $data)) {
                throw new \InvalidArgumentException('Stored token record is incomplete.');
            }
        }
        return new self(
            (string) $data['access_token'],
            (string) $data['refresh_token'],
            (int) $data['expires_at'],
            array_values(array_map('strval', (array) $data['scopes'])),
            (int) $data['obtained_at'],
        );
    }

    /** Never print a token by accident (var_dump, print_r, error logs). */
    public function __debugInfo(): array
    {
        return ['expires_at' => $this->expiresAt, 'scopes' => $this->scopes, 'user_id' => $this->userId()];
    }
}
