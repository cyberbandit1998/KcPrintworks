<?php
declare(strict_types=1);

namespace KcPrintworks\Quotes\Auth;

/**
 * Request signing between the storefront server and this plugin (never the browser).
 *
 *   canonical = "KCPW1" \n timestamp \n nonce \n METHOD \n route \n sha256hex(body)
 *   signature = hex(HMAC-SHA256(secret, canonical))
 *
 * Headers: X-Kcpw-Timestamp (unix seconds), X-Kcpw-Nonce (16 to 64 of A-Z a-z 0-9 _ -), X-Kcpw-Signature (64 hex).
 * `route` is the REST route without the /wp-json prefix, for example "/kcpw-quotes/v1/requests", so permalink settings
 * cannot change what is signed. packages/contracts/test/vectors/signing.json is shared with the TypeScript side.
 */
final class RequestSigner
{
    public static function canonical(string $timestamp, string $nonce, string $method, string $route, string $body): string
    {
        return implode("\n", ['KCPW1', $timestamp, $nonce, strtoupper($method), $route, hash('sha256', $body)]);
    }

    public static function sign(string $secret, string $timestamp, string $nonce, string $method, string $route, string $body): string
    {
        return hash_hmac('sha256', self::canonical($timestamp, $nonce, $method, $route, $body), $secret);
    }
}
