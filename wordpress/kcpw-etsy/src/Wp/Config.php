<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Wp;

use KcPrintworks\Etsy\Api\ApiKeyHeader;
use KcPrintworks\Etsy\Oauth\OAuthConfig;
use KcPrintworks\Etsy\Oauth\Scopes;
use KcPrintworks\Etsy\Vault\TokenVault;

/**
 * Configuration comes from constants in wp-config.php, never from the database:
 *   KCPW_ETSY_API_KEY        the Seller App's API key (keystring)               required
 *   KCPW_ETSY_ENC_KEY        32+ random characters; encrypts the stored tokens  required (or the WordPress salts are used)
 *   KCPW_ETSY_SHARED_SECRET  the app's shared secret                            only if Etsy requires it in the header
 *   KCPW_ETSY_SEND_SECRET    true to send "keystring:secret" as x-api-key       only if Etsy requires it
 *   KCPW_ETSY_AUTO_REFRESH   true for a daily background download               optional
 *   KCPW_ETSY_KEEP_DATA      true to keep decisions and snapshots on uninstall  optional
 */
final class Config
{
    public static function constant(string $name): string
    {
        return defined($name) ? (string) constant($name) : '';
    }

    public static function flag(string $name): bool
    {
        return defined($name) && constant($name) === true;
    }

    /** @return list<string> constants that must be defined before connecting */
    public static function missing(): array
    {
        $missing = [];
        if (self::constant('KCPW_ETSY_API_KEY') === '') {
            $missing[] = 'KCPW_ETSY_API_KEY';
        }
        if (self::encryptionMaterial() === '') {
            $missing[] = 'KCPW_ETSY_ENC_KEY';
        }
        return $missing;
    }

    private static function encryptionMaterial(): string
    {
        $dedicated = self::constant('KCPW_ETSY_ENC_KEY');
        if (strlen($dedicated) >= 32) {
            return $dedicated;
        }
        // Fall back to the WordPress salts (changing them means reconnecting Etsy).
        $salts = self::constant('AUTH_KEY') . self::constant('SECURE_AUTH_KEY');
        return strlen($salts) >= 32 && !str_contains($salts, 'put your unique phrase here') ? $salts : '';
    }

    public static function encryptionKey(): string
    {
        $material = self::encryptionMaterial();
        if ($material === '') {
            throw new \RuntimeException('No encryption key is configured (KCPW_ETSY_ENC_KEY).');
        }
        return TokenVault::keyFromMaterial($material);
    }

    public static function oauth(string $redirectUri): OAuthConfig
    {
        return new OAuthConfig(self::constant('KCPW_ETSY_API_KEY'), $redirectUri, Scopes::PRODUCT_IMPORT);
    }

    public static function apiKeyHeader(): ApiKeyHeader
    {
        return new ApiKeyHeader(self::constant('KCPW_ETSY_API_KEY'), self::constant('KCPW_ETSY_SHARED_SECRET'), self::flag('KCPW_ETSY_SEND_SECRET'));
    }
}
