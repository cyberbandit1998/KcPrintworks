<?php
declare(strict_types=1);

namespace KcPrintworks\Quotes\Domain;

/**
 * The secret in a customer's quote link. 32 random bytes, written in 43 URL-safe characters. Only its SHA-256 is stored, so a copy of the
 * database cannot be turned into working links. Sending a quote (again) makes a new token, which stops every earlier link working.
 */
final class Token
{
    public const LENGTH = 43;

    public static function generate(): string
    {
        return rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
    }

    public static function hash(string $token): string
    {
        return hash('sha256', $token);
    }

    public static function wellFormed(string $token): bool
    {
        return preg_match('/^[A-Za-z0-9_-]{' . self::LENGTH . '}$/D', $token) === 1;
    }

    /** Constant-time. A quote with no live link ('' stored) matches nothing. */
    public static function matches(string $token, string $storedHash): bool
    {
        if ($storedHash === '' || !self::wellFormed($token)) {
            return false;
        }
        return hash_equals($storedHash, self::hash($token));
    }
}
