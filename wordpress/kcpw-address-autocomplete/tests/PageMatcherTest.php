<?php
declare(strict_types=1);

namespace KcPrintworks\AddressAutocomplete\Tests;

use KcPrintworks\AddressAutocomplete\FormConfig;
use KcPrintworks\AddressAutocomplete\PageMatcher;

final class PageMatcherTest extends TestCase
{
    private function form(string $mode, array $pages = []): array
    {
        $f = FormConfig::blank('woo_block');
        $f['pages'] = $pages + ['mode' => $mode, 'ids' => [], 'paths' => [], 'account_address' => false];
        return $f;
    }

    public function testCheckoutModeMatchesOnlyTheCheckoutAndNeverTheOrderReceivedPage(): void
    {
        $f = $this->form('checkout');
        $this->assertTrue(PageMatcher::matches($f, ['isCheckout' => true]));
        $this->assertFalse(PageMatcher::matches($f, ['isCheckout' => true, 'isOrderReceived' => true]));
        $this->assertFalse(PageMatcher::matches($f, ['isCheckout' => false, 'postId' => 5, 'path' => '/cart/']));
        $this->assertFalse(PageMatcher::matches($f, []));
    }

    public function testAccountAddressScreensAreOptIn(): void
    {
        $f = $this->form('checkout', ['account_address' => true]);
        $this->assertTrue(PageMatcher::matches($f, ['isAccountAddress' => true]));
        $this->assertFalse(PageMatcher::matches($this->form('checkout'), ['isAccountAddress' => true]));
    }

    public function testSelectedPagesMatchByIdOrPath(): void
    {
        $f = $this->form('selected', ['ids' => [12], 'paths' => ['/contact/', '/shop/*']]);
        $this->assertTrue(PageMatcher::matches($f, ['postId' => 12]));
        $this->assertTrue(PageMatcher::matches($f, ['path' => '/contact']));
        $this->assertTrue(PageMatcher::matches($f, ['path' => '/shop/hats/red/']));
        $this->assertFalse(PageMatcher::matches($f, ['path' => '/shopping/']));
        $this->assertFalse(PageMatcher::matches($f, ['postId' => 13, 'path' => '/about/']));
    }

    public function testAllAndDisabled(): void
    {
        $this->assertTrue(PageMatcher::matches($this->form('all'), []));
        $off = $this->form('all');
        $off['enabled'] = false;
        $this->assertFalse(PageMatcher::matches($off, ['isCheckout' => true]));
        $this->assertSame(1, count(PageMatcher::select([$this->form('all'), $off], [])));
    }
}
