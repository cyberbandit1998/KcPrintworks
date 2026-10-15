<?php
declare(strict_types=1);

namespace KcPrintworks\AddressAutocomplete;

/**
 * Decides which forms are offered on the page being shown ("per-page activation"). Pure PHP: the WordPress layer fills in the
 * context, so the rules can be tested without WordPress.
 *
 * Context keys: postId (int), isCheckout (bool), isOrderReceived (bool), isAccountAddress (bool), path (string, e.g. "/contact/").
 */
final class PageMatcher
{
    /**
     * @param array<string, mixed> $form
     * @param array<string, mixed> $ctx
     */
    public static function matches(array $form, array $ctx): bool
    {
        if (($form['enabled'] ?? false) !== true) {
            return false;
        }
        $pages = is_array($form['pages'] ?? null) ? $form['pages'] : [];
        $mode = $pages['mode'] ?? 'selected';

        if (($pages['account_address'] ?? false) === true && ($ctx['isAccountAddress'] ?? false) === true) {
            return true;
        }
        switch ($mode) {
            case 'all':
                return true;
            case 'checkout':
                // Never on the order-received page: there is no address form there.
                return ($ctx['isCheckout'] ?? false) === true && ($ctx['isOrderReceived'] ?? false) !== true;
            default:
                $postId = (int) ($ctx['postId'] ?? 0);
                if ($postId > 0 && in_array($postId, $pages['ids'] ?? [], true)) {
                    return true;
                }
                $path = (string) ($ctx['path'] ?? '');
                foreach ($pages['paths'] ?? [] as $pattern) {
                    if (self::pathMatches((string) $pattern, $path)) {
                        return true;
                    }
                }
                return false;
        }
    }

    /**
     * @param list<array<string, mixed>> $forms
     * @param array<string, mixed> $ctx
     * @return list<array<string, mixed>>
     */
    public static function select(array $forms, array $ctx): array
    {
        return array_values(array_filter($forms, static fn (array $form): bool => self::matches($form, $ctx)));
    }

    /** `/contact/` matches itself (with or without the trailing slash); `/shop/*` matches everything below /shop/. */
    public static function pathMatches(string $pattern, string $path): bool
    {
        if ($pattern === '' || $path === '') {
            return false;
        }
        $path = '/' . ltrim($path, '/');
        if (str_ends_with($pattern, '*')) {
            return str_starts_with($path, substr($pattern, 0, -1));
        }
        return rtrim($pattern, '/') === rtrim($path, '/');
    }
}
