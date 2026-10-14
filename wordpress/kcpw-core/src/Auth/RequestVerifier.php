<?php
declare(strict_types=1);

namespace KcPrintworks\Core\Auth;

final class RequestVerifier
{
    public const OK = 'ok';
    public const NOT_CONFIGURED = 'not_configured';
    public const MISSING = 'missing_headers';
    public const STALE = 'stale';
    public const BAD_SIGNATURE = 'bad_signature';
    public const REPLAY = 'replay';

    public const MIN_SECRET_LENGTH = 32;
    public const WINDOW_SECONDS = 300;

    public function __construct(
        private readonly string $secret,
        private readonly NonceStore $nonces,
    ) {
    }

    /** @param array<string,string> $headers header name (lower case) => value */
    public function verify(string $method, string $route, string $body, array $headers, int $now): string
    {
        if (strlen($this->secret) < self::MIN_SECRET_LENGTH) {
            return self::NOT_CONFIGURED;
        }
        $timestamp = $headers['x-kcpw-timestamp'] ?? '';
        $nonce = $headers['x-kcpw-nonce'] ?? '';
        $signature = strtolower($headers['x-kcpw-signature'] ?? '');
        if (!preg_match('/^\d{9,12}$/', $timestamp) || !preg_match('/^[A-Za-z0-9_-]{16,64}$/', $nonce) || !preg_match('/^[0-9a-f]{64}$/', $signature)) {
            return self::MISSING;
        }
        if (abs($now - (int) $timestamp) > self::WINDOW_SECONDS) {
            return self::STALE;
        }
        $expected = RequestSigner::sign($this->secret, $timestamp, $nonce, $method, $route, $body);
        if (!hash_equals($expected, $signature)) {
            return self::BAD_SIGNATURE;
        }
        // Only a correctly signed request may use up a nonce, so strangers cannot fill the store.
        if (!$this->nonces->remember($nonce, self::WINDOW_SECONDS * 2)) {
            return self::REPLAY;
        }
        return self::OK;
    }
}
