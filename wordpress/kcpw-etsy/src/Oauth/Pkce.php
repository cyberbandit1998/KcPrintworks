<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Oauth;

/** RFC 7636 PKCE with the S256 method. */
final class Pkce
{
    public static function verifier(int $bytes = 48): string
    {
        if ($bytes < 32 || $bytes > 96) {
            throw new \InvalidArgumentException('A PKCE verifier needs 32 to 96 random bytes (43 to 128 characters).');
        }
        return self::base64Url(random_bytes($bytes));
    }

    public static function challenge(string $verifier): string
    {
        return self::base64Url(hash('sha256', $verifier, true));
    }

    public static function state(): string
    {
        return self::base64Url(random_bytes(32));
    }

    public static function base64Url(string $binary): string
    {
        return rtrim(strtr(base64_encode($binary), '+/', '-_'), '=');
    }
}
