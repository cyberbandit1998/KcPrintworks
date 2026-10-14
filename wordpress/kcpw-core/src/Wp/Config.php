<?php
declare(strict_types=1);

namespace KcPrintworks\Core\Wp;

/**
 * Settings live in wp-config.php constants, never in the database or the admin screens (the secret must not be readable
 * by a plugin that can read options, and must not appear in backups of the database alone).
 *
 *   KCPW_HANDOFF_SECRET   32+ random characters shared with the storefront server (its KCPW_HANDOFF_SECRET environment value)
 *   KCPW_STOREFRONT_URL   where the storefront lives, for example https://staging.kcprintworks.com (used to send a shopper back to the cart)
 */
final class Config
{
    public static function secret(): string
    {
        return defined('KCPW_HANDOFF_SECRET') && is_string(KCPW_HANDOFF_SECRET) ? KCPW_HANDOFF_SECRET : '';
    }

    public static function storefrontUrl(): string
    {
        $url = defined('KCPW_STOREFRONT_URL') && is_string(KCPW_STOREFRONT_URL) ? trim(KCPW_STOREFRONT_URL) : '';
        return self::validStorefrontUrl($url) ? rtrim($url, '/') : '';
    }

    public static function validStorefrontUrl(string $url): bool
    {
        $parts = parse_url($url);
        if ($parts === false || !isset($parts['scheme'], $parts['host']) || isset($parts['user']) || isset($parts['pass'])) {
            return false;
        }
        $local = in_array($parts['host'], ['localhost', '127.0.0.1'], true);
        return $parts['scheme'] === 'https' || ($parts['scheme'] === 'http' && $local);
    }
}
