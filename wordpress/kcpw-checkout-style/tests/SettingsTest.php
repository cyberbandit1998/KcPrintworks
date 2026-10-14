<?php
declare(strict_types=1);

namespace KcPrintworks\CheckoutStyle\Tests;

use KcPrintworks\CheckoutStyle\Settings;

final class SettingsTest extends TestCase
{
    public function testModeDefaultsToOnAndAnythingUnknownIsOff(): void
    {
        $this->assertSame('on', Settings::mode(null));
        foreach (['on', 'ON', ' on '] as $value) {
            $this->assertSame('on', Settings::mode($value), $value);
        }
        $this->assertSame('admins', Settings::mode('admins'));
        $this->assertSame('off', Settings::mode('off'));
        // A typo must never switch the new look on for customers.
        foreach (['admin', 'preview', '', 'true', 1, true, [], 0] as $value) {
            $this->assertSame('off', Settings::mode($value), var_export($value, true));
        }
    }

    public function testPageIdDefaultsToNineAndAcceptsOnlyPositiveIntegers(): void
    {
        $this->assertSame(9, Settings::pageId(null));
        $this->assertSame(42, Settings::pageId(42));
        $this->assertSame(42, Settings::pageId('42'));
        foreach ([0, -3, '0', '-1', 'abc', '9; DROP', 4.5, true, []] as $value) {
            $this->assertSame(9, Settings::pageId($value), var_export($value, true));
        }
    }

    public function testStorefrontOriginKeepsOnlySchemeHostAndPort(): void
    {
        $this->assertSame('https://kcprintworks.com', Settings::storefrontOrigin('https://kcprintworks.com'));
        $this->assertSame('https://kcprintworks.com', Settings::storefrontOrigin('https://kcprintworks.com/'));
        $this->assertSame('https://kcprintworks.com', Settings::storefrontOrigin(' https://KCPrintWorks.com/cart/?x=1#y '));
        $this->assertSame('https://store.example.com:8443', Settings::storefrontOrigin('https://store.example.com:8443/a'));
        $this->assertSame('http://localhost:3000', Settings::storefrontOrigin('http://localhost:3000'));
    }

    public function testStorefrontOriginRefusesAnythingUnsafe(): void
    {
        foreach ([null, '', '   ', 5, 'kcprintworks.com', 'http://kcprintworks.com', 'ftp://kcprintworks.com', 'javascript:alert(1)',
            'https://user:pass@kcprintworks.com', 'https://', '//kcprintworks.com', 'https://exa mple.com', 'https://evil.com"onmouseover="x'] as $value) {
            $this->assertSame('', Settings::storefrontOrigin($value), var_export($value, true));
        }
    }

    public function testHideSelectorsAcceptsPlainClassAndIdSelectors(): void
    {
        $this->assertSame(['.promo-bar', '#free-ship-banner'], Settings::hideSelectors('.promo-bar, #free-ship-banner'));
        $this->assertSame(['.a > .b .c'], Settings::hideSelectors('  .a   >   .b   .c '));
        $this->assertSame(['.ok', '.also-ok'], Settings::hideSelectors('.ok,,  .also-ok, .ok'));
        $this->assertSame(['div.top-banner'], Settings::hideSelectors('div.top-banner'));
    }

    public function testHideSelectorsDropsAnythingThatCouldBreakTheStylesheetOrThePage(): void
    {
        foreach (['div', 'p', '*', 'a{color:red}', '.x}body{display:none', ".x[y='z']", '.x:hover', '.x::before', '@import "x"', '.x;.y',
            '.x /* c */', "url(javascript:x)", '.x<script>', '', ' , ', '.a >.b', '.a> .b'] as $value) {
            $this->assertSame([], Settings::hideSelectors($value), $value);
        }
        $this->assertSame([], Settings::hideSelectors(null));
        $this->assertSame([], Settings::hideSelectors(['.x']));
    }

    public function testHideSelectorsCanNeverRemoveTheCheckoutItsFieldsItsButtonsOrAPaymentMethod(): void
    {
        foreach (['.wc-block-components-button', '.wp-block-woocommerce-checkout', '#stripe-card', '.paypal-buttons', '.wc-stripe-elements-field',
            '.payment-banner', '.ppcp-button', '.place-order', '.order-summary', '.express-pay', '.checkout-form', '.my-input', '.save-button',
            '.gateway-box', '.woocommerce-checkout-review-order'] as $value) {
            $this->assertSame([], Settings::hideSelectors($value), $value);
        }
    }

    public function testHideSelectorsAreCappedAtTwenty(): void
    {
        $many = implode(',', array_map(static fn (int $i): string => '.promo-' . $i, range(1, 40)));
        $this->assertSame(20, count(Settings::hideSelectors($many)));
    }

    public function testHideCssScopesEverySelectorToTheCheckoutPage(): void
    {
        $this->assertSame('', Settings::hideCss([]));
        $this->assertSame(
            'body.kcpw-checkout .a,body.kcpw-checkout #b{display:none!important}',
            Settings::hideCss(['.a', '#b']),
        );
    }
}
