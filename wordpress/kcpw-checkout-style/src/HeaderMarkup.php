<?php
declare(strict_types=1);

namespace KcPrintworks\CheckoutStyle;

/**
 * The compact checkout header: the storefront's wordmark (a "KC" mark and the name, drawn in HTML and CSS exactly like the
 * storefront's header, so there is no image to load), a reassurance label, and one link back. Pure PHP: it returns an escaped HTML
 * string and calls no WordPress function. It holds no navigation, search or cart: nothing to distract from paying.
 */
final class HeaderMarkup
{
    public const VARIANT_CHECKOUT = 'checkout';
    public const VARIANT_CONFIRMATION = 'confirmation';

    private const LOCK = '<svg class="kcpw-co-header__lock" aria-hidden="true" focusable="false" width="16" height="16" viewBox="0 0 16 16"><path fill="currentColor" d="M8 1a3.5 3.5 0 0 0-3.5 3.5V6H4a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1h-.5V4.5A3.5 3.5 0 0 0 8 1Zm-2 3.5a2 2 0 1 1 4 0V6H6V4.5Z"/></svg>';

    /**
     * @param string $brandUrl where the logo goes (an absolute URL)
     * @param string $backUrl  where the one link goes (an absolute URL)
     */
    public static function render(string $variant, string $brandUrl, string $backUrl): string
    {
        $confirmation = $variant === self::VARIANT_CONFIRMATION;
        $label = $confirmation ? 'Order confirmation' : 'Secure checkout';
        $backLabel = $confirmation ? 'Continue shopping' : 'Back to cart';
        $arrow = $confirmation ? '' : '<span aria-hidden="true">&larr;</span> ';

        return '<header class="kcpw-co-header">'
            . '<div class="kcpw-co-header__inner">'
            . '<a class="kcpw-co-brand" href="' . self::esc($brandUrl) . '">'
            . '<span class="kcpw-co-brand__mark" aria-hidden="true">KC</span>'
            . '<span class="kcpw-co-brand__name">KCPrintWorks</span>'
            . '</a>'
            . '<p class="kcpw-co-header__label">' . self::LOCK . '<span>' . self::esc($label) . '</span></p>'
            . '<a class="kcpw-co-header__back" href="' . self::esc($backUrl) . '">' . $arrow . self::esc($backLabel) . '</a>'
            . '</div>'
            . '</header>';
    }

    private static function esc(string $text): string
    {
        return htmlspecialchars($text, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    }
}
