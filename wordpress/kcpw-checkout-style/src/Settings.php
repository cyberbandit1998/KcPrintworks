<?php
declare(strict_types=1);

namespace KcPrintworks\CheckoutStyle;

/**
 * Reads and validates the plugin's wp-config.php constants. Pure PHP (no WordPress calls) so it can be tested without WordPress.
 * Anything unrecognised falls back to the SAFE side: a mistyped mode leaves the checkout exactly as it was.
 *
 *   KCPW_CHECKOUT_STYLE            'on' (default) | 'admins' (only logged-in administrators see it: a safe preview) | 'off'
 *   KCPW_CHECKOUT_STYLE_PAGE_ID    the checkout page's ID (default 9)
 *   KCPW_CHECKOUT_STYLE_HIDE       extra elements to hide on the checkout page, e.g. '.promo-bar, #free-ship-banner'
 *   KCPW_STOREFRONT_URL            (already set for kcpw-core) where the header's logo and "Back to cart" send the shopper
 */
final class Settings
{
    public const DEFAULT_PAGE_ID = 9;
    public const MODE_ON = 'on';
    public const MODE_ADMINS = 'admins';
    public const MODE_OFF = 'off';

    private const MAX_HIDE_SELECTORS = 20;
    private const MAX_SELECTOR_LENGTH = 100;
    /** Never hideable through the setting, whatever is typed: the checkout itself, its fields, and every way of paying. */
    private const PROTECTED = '/(wc-block|woocommerce|checkout|payment|gateway|stripe|paypal|ppcp|place-order|order-summary|express|form|input|button)/i';

    public static function mode(mixed $value): string
    {
        if ($value === null) {
            return self::MODE_ON;
        }
        $mode = is_string($value) ? strtolower(trim($value)) : '';
        return in_array($mode, [self::MODE_ON, self::MODE_ADMINS, self::MODE_OFF], true) ? $mode : self::MODE_OFF;
    }

    public static function pageId(mixed $value): int
    {
        $id = is_int($value) ? $value : (is_string($value) && ctype_digit($value) ? (int) $value : 0);
        return $id > 0 ? $id : self::DEFAULT_PAGE_ID;
    }

    /** The storefront's origin (scheme, host, port) or '' when unset or unusable. https only, except a local address for testing. */
    public static function storefrontOrigin(mixed $value): string
    {
        if (!is_string($value) || trim($value) === '') {
            return '';
        }
        $parts = parse_url(trim($value));
        if ($parts === false || !isset($parts['scheme'], $parts['host']) || isset($parts['user']) || isset($parts['pass'])) {
            return '';
        }
        $scheme = strtolower($parts['scheme']);
        $host = strtolower($parts['host']);
        $local = in_array($host, ['localhost', '127.0.0.1'], true);
        if ($scheme !== 'https' && !($scheme === 'http' && $local)) {
            return '';
        }
        if (preg_match('/^[a-z0-9.-]+$/', $host) !== 1) {
            return '';
        }
        $port = isset($parts['port']) ? ':' . (int) $parts['port'] : '';
        return $scheme . '://' . $host . $port;
    }

    /**
     * The optional extra selectors to hide. They end up inside a stylesheet, so only plain class, id and tag selectors (optionally
     * chained with a space or ">") that contain at least one class or id are accepted; anything else is dropped. No attribute
     * selectors, pseudo-classes, quotes or braces, and nothing that names the checkout, a field, a button or a payment method.
     *
     * @return list<string>
     */
    public static function hideSelectors(mixed $value): array
    {
        if (!is_string($value)) {
            return [];
        }
        $simple = '(?:[a-z][a-z0-9]*)?(?:[.#][A-Za-z_][A-Za-z0-9_-]*)*';
        $pattern = '/^' . $simple . '(?:(?: > | )' . $simple . ')*$/';
        $out = [];
        foreach (explode(',', $value) as $candidate) {
            $selector = trim((string) preg_replace('/\s+/', ' ', $candidate));
            if ($selector === '' || strlen($selector) > self::MAX_SELECTOR_LENGTH || preg_match($pattern, $selector) !== 1) {
                continue;
            }
            if (preg_match('/[.#]/', $selector) !== 1 || preg_match(self::PROTECTED, $selector) === 1) {
                continue;
            }
            $out[$selector] = $selector;
            if (count($out) >= self::MAX_HIDE_SELECTORS) {
                break;
            }
        }
        return array_values($out);
    }

    /**
     * @param list<string> $selectors already validated, or fixed by this plugin
     */
    public static function hideCss(array $selectors): string
    {
        if ($selectors === []) {
            return '';
        }
        $scoped = array_map(static fn (string $s): string => 'body.kcpw-checkout ' . $s, $selectors);
        return implode(',', $scoped) . '{display:none!important}';
    }
}
