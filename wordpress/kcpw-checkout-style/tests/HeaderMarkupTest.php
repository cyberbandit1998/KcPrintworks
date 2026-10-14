<?php
declare(strict_types=1);

namespace KcPrintworks\CheckoutStyle\Tests;

use KcPrintworks\CheckoutStyle\HeaderMarkup;

final class HeaderMarkupTest extends TestCase
{
    public function testCheckoutHeaderHasTheWordmarkALabelAndOneWayBack(): void
    {
        $html = HeaderMarkup::render(HeaderMarkup::VARIANT_CHECKOUT, 'https://kcprintworks.com/', 'https://kcprintworks.com/cart/');
        $this->assertContains('<header class="kcpw-co-header">', $html);
        $this->assertContains('<span class="kcpw-co-brand__mark" aria-hidden="true">KC</span>', $html);
        $this->assertContains('<span class="kcpw-co-brand__name">KCPrintWorks</span>', $html);
        $this->assertContains('href="https://kcprintworks.com/"', $html);
        $this->assertContains('Secure checkout', $html);
        $this->assertContains('href="https://kcprintworks.com/cart/"', $html);
        $this->assertContains('Back to cart', $html);
        $this->assertSame(2, substr_count($html, '<a '), 'the logo and the way back, nothing else to click');
    }

    public function testConfirmationHeaderSaysSoAndLeadsBackToShopping(): void
    {
        $html = HeaderMarkup::render(HeaderMarkup::VARIANT_CONFIRMATION, 'https://kcprintworks.com/', 'https://kcprintworks.com/shop/');
        $this->assertContains('Order confirmation', $html);
        $this->assertContains('Continue shopping', $html);
        $this->assertContains('href="https://kcprintworks.com/shop/"', $html);
        $this->assertNotContains('Back to cart', $html);
    }

    public function testNothingThatCouldRunOrLoadIsInTheMarkup(): void
    {
        $html = HeaderMarkup::render(HeaderMarkup::VARIANT_CHECKOUT, 'https://kcprintworks.com/', 'https://kcprintworks.com/cart/');
        foreach (['<script', '<img', '<iframe', 'onclick', 'onerror', 'javascript:', 'src=', 'url('] as $forbidden) {
            $this->assertNotContains($forbidden, $html, $forbidden);
        }
    }

    public function testAddressesAreEscapedSoNothingCanBreakOutOfTheAttribute(): void
    {
        $html = HeaderMarkup::render(HeaderMarkup::VARIANT_CHECKOUT, 'https://a.test/"><script>alert(1)</script>', "https://b.test/'onmouseover='x");
        $this->assertNotContains('<script', $html);
        $this->assertNotContains("'onmouseover='x", $html);
        $this->assertContains('&quot;&gt;&lt;script&gt;', $html);
        $this->assertContains('&#039;onmouseover=&#039;x', $html);
    }

    public function testTheIconIsDecorativeForAssistiveTechnology(): void
    {
        $html = HeaderMarkup::render(HeaderMarkup::VARIANT_CHECKOUT, 'https://kcprintworks.com/', 'https://kcprintworks.com/cart/');
        $this->assertContains('class="kcpw-co-header__lock" aria-hidden="true" focusable="false"', $html);
        $this->assertContains('<span aria-hidden="true">&larr;</span>', $html);
    }
}
