<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Vault;

/**
 * Authenticated encryption for secrets at rest (libsodium secretbox: XSalsa20-Poly1305).
 * Key material comes from wp-config.php (a dedicated constant, or the WordPress salts); it is hashed to 32 bytes.
 * Changing the key makes stored values unreadable, which surfaces as "reconnect Etsy", never as a crash.
 */
final class TokenVault
{
    private const VERSION = 'v1.';

    public static function keyFromMaterial(string $material): string
    {
        if (strlen($material) < 32) {
            throw new \InvalidArgumentException('Encryption key material must be at least 32 characters.');
        }
        return sodium_crypto_generichash($material, '', SODIUM_CRYPTO_SECRETBOX_KEYBYTES);
    }

    public static function encrypt(string $plaintext, string $key): string
    {
        $nonce = random_bytes(SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);
        $cipher = sodium_crypto_secretbox($plaintext, $nonce, $key);
        return self::VERSION . rtrim(strtr(base64_encode($nonce . $cipher), '+/', '-_'), '=');
    }

    /** @return string|null null when the value is malformed, tampered with, or encrypted under another key */
    public static function decrypt(string $stored, string $key): ?string
    {
        if (strncmp($stored, self::VERSION, strlen(self::VERSION)) !== 0) {
            return null;
        }
        $raw = base64_decode(strtr(substr($stored, strlen(self::VERSION)), '-_', '+/'), true);
        if ($raw === false || strlen($raw) < SODIUM_CRYPTO_SECRETBOX_NONCEBYTES + SODIUM_CRYPTO_SECRETBOX_MACBYTES) {
            return null;
        }
        $nonce = substr($raw, 0, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);
        $plain = sodium_crypto_secretbox_open(substr($raw, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES), $nonce, $key);
        return $plain === false ? null : $plain;
    }
}
