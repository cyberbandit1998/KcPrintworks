<?php
declare(strict_types=1);

namespace KcPrintworks\Quotes\Wp;

use KcPrintworks\Quotes\Service\Settings;

/**
 * Settings live in wp-config.php constants, never in the database or the admin screens (the secret must not be readable by a plugin
 * that can read options, and must not appear in a database backup alone). Only the first two are needed; they are the same two
 * kcpw-core already uses, so nothing existing changes.
 *
 *   KCPW_HANDOFF_SECRET        32+ random characters shared with the storefront server (REQUIRED; already set for checkout)
 *   KCPW_STOREFRONT_URL        where the storefront lives, e.g. https://kcprintworks.com (REQUIRED to send a quote: it is the base of the customer's link)
 *   KCPW_QUOTES_NOTIFY_EMAIL   who is told about new requests (default contact@kcprintworks.com)
 *   KCPW_QUOTES_UPLOAD_DIR     an absolute folder OUTSIDE the web root for the pictures (default: a protected folder inside uploads)
 *   KCPW_QUOTES_TAXABLE        true to let WooCommerce add sales tax on top of a quote's amounts (default false: the quoted total is the total)
 *   KCPW_QUOTES_VALID_DAYS     how long a new offer stands by default (1-90, default 14)
 *   KCPW_QUOTES_PAY_HOURS      how long after approving the customer has to pay (1-720, default 72)
 *   KCPW_QUOTES_MAX_PER_HOUR   requests per visitor per hour (default 6); KCPW_QUOTES_MAX_ALL_PER_HOUR for the whole shop (default 100)
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

    public static function notifyEmail(): string
    {
        $email = defined('KCPW_QUOTES_NOTIFY_EMAIL') && is_string(KCPW_QUOTES_NOTIFY_EMAIL) ? trim(KCPW_QUOTES_NOTIFY_EMAIL) : '';
        return $email !== '' && is_email($email) !== false ? $email : 'contact@kcprintworks.com';
    }

    /** Where picture files go, with whether that folder is inside the public uploads folder. @return array{dir:string,insideUploads:bool} */
    public static function uploadDir(): array
    {
        $custom = defined('KCPW_QUOTES_UPLOAD_DIR') && is_string(KCPW_QUOTES_UPLOAD_DIR) ? trim(KCPW_QUOTES_UPLOAD_DIR) : '';
        if ($custom !== '' && str_starts_with($custom, '/') && !str_contains($custom, '..')) {
            return ['dir' => rtrim($custom, '/'), 'insideUploads' => false];
        }
        $uploads = wp_upload_dir(null, false);
        return ['dir' => rtrim((string) ($uploads['basedir'] ?? ''), '/') . '/kcpw-quotes-private', 'insideUploads' => true];
    }

    private static function intConstant(string $name, int $default, int $min, int $max): int
    {
        if (!defined($name)) {
            return $default;
        }
        $value = constant($name);
        return is_int($value) && $value >= $min && $value <= $max ? $value : $default;
    }

    public static function settings(): Settings
    {
        $zone = function_exists('wp_timezone_string') ? (string) wp_timezone_string() : 'UTC';
        return new Settings(
            self::secret(),
            self::storefrontUrl(),
            self::notifyEmail(),
            'KCPrintWorks',
            $zone !== '' ? $zone : 'UTC',
            defined('KCPW_QUOTES_TAXABLE') && KCPW_QUOTES_TAXABLE === true,
            self::intConstant('KCPW_QUOTES_VALID_DAYS', 14, 1, 90),
            self::intConstant('KCPW_QUOTES_PAY_HOURS', 72, 1, 720) * 3600,
            self::intConstant('KCPW_QUOTES_MAX_PER_HOUR', 6, 1, 1000),
            self::intConstant('KCPW_QUOTES_MAX_ALL_PER_HOUR', 100, 1, 100000),
        );
    }
}
