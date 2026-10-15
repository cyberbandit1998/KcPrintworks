<?php
declare(strict_types=1);

namespace KcPrintworks\AddressAutocomplete\Tests;

use KcPrintworks\AddressAutocomplete\FormConfig;
use KcPrintworks\AddressAutocomplete\Frontend;
use KcPrintworks\AddressAutocomplete\Picker;
use KcPrintworks\AddressAutocomplete\Settings;

final class PickerTest extends TestCase
{
    private function picker(): Picker
    {
        return new Picker('/x/kcpw-address-autocomplete/kcpw-address-autocomplete.php', '0.1.0');
    }

    public function testItIsRegisteredEarly(): void
    {
        $this->picker()->register();
        $this->assertSame(1, \WpStub::$actions['wp'][0][1], 'before the autocomplete decides what to load');
    }

    public function testNoQueryNoPicking(): void
    {
        \WpStub::$canManage = true;
        $this->picker()->maybeActivate();
        $this->assertFalse(Picker::active());
    }

    public function testItNeedsAValidNonceAndTheCapability(): void
    {
        $p = $this->picker();
        // a visitor with a real-looking token
        $_GET['kcpw_aa_pick'] = 'nonce-kcpw_aa_pick';
        \WpStub::$canManage = false;
        $p->maybeActivate();
        $this->assertFalse(Picker::active(), 'a visitor cannot switch it on');
        // an administrator with a wrong or stale token
        \WpStub::$canManage = true;
        $_GET['kcpw_aa_pick'] = 'guess';
        $p->maybeActivate();
        $this->assertFalse(Picker::active(), 'a wrong token does nothing');
        // the right token for ANOTHER action
        $_GET['kcpw_aa_pick'] = 'nonce-something_else';
        $p->maybeActivate();
        $this->assertFalse(Picker::active());
        // both right
        $_GET['kcpw_aa_pick'] = 'nonce-kcpw_aa_pick';
        $p->maybeActivate();
        $this->assertTrue(Picker::active());
        $this->assertSame(['nocache'], \WpStub::$headers);
        $this->assertTrue(isset(\WpStub::$actions['filter:wp_robots']), 'the picking page is kept out of search results');
    }

    public function testTheTokenIsNotAcceptedWhenTheNonceIsInvalid(): void
    {
        \WpStub::$canManage = true;
        \WpStub::$nonceValid = false;
        $_GET['kcpw_aa_pick'] = 'nonce-kcpw_aa_pick';
        $this->picker()->maybeActivate();
        $this->assertFalse(Picker::active());
    }

    public function testItEnqueuesThePickingScriptWithItsOwnSentencesOnly(): void
    {
        \WpStub::$canManage = true;
        $_GET['kcpw_aa_pick'] = 'nonce-kcpw_aa_pick';
        $p = $this->picker();
        $p->maybeActivate();
        \WpStub::run('wp_enqueue_scripts');
        $this->assertSame(['kcpw-aa-picker'], array_column(\WpStub::$scripts, 'handle'));
        $this->assertSame(['kcpw-aa-picker'], array_column(\WpStub::$styles, 'handle'));
        $js = \WpStub::$inline['kcpw-aa-picker:before'];
        $this->assertContains('window.KCPW_AA_PICKER=', $js);
        $this->assertContains('Press Esc to cancel', $js);
        $this->assertNotContains('key', strtolower(str_replace('keyboard', '', $js)));
    }

    public function testTheAutocompleteStepsAsideWhilePicking(): void
    {
        \WpStub::$canManage = true;
        \WpStub::$isCheckout = true;
        $settings = Settings::load(['mode' => 'live', 'browser_key' => 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789']);
        $f = new Frontend('/x/f.php', '0.1.0', $settings, FormConfig::sanitizeList([FormConfig::blank('woo_block')]));
        $f->enqueue();
        $this->assertSame(1, count(\WpStub::$scripts), 'normally it loads');
        \WpStub::reset();
        \WpStub::$canManage = true;
        \WpStub::$isCheckout = true;
        $_GET['kcpw_aa_pick'] = 'nonce-kcpw_aa_pick';
        $this->picker()->maybeActivate();
        $f2 = new Frontend('/x/f.php', '0.1.0', $settings, FormConfig::sanitizeList([FormConfig::blank('woo_block')]));
        $f2->enqueue();
        $this->assertFalse(in_array('kcpw-aa', array_column(\WpStub::$scripts, 'handle'), true));
    }

    public function testAdminDataHoldsATokenAndOnlyPagesOfThisSite(): void
    {
        \WpStub::$pages = [(object) ['ID' => 4, 'post_title' => 'Contact'], (object) ['ID' => 5, 'post_title' => 'Book']];
        \WpStub::$wooPages = ['checkout' => 'https://shop.example.test/checkout/', 'cart' => 'https://shop.example.test/cart/', 'shop' => 'https://evil.example.test/shop/', 'myaccount' => ''];
        $d = Picker::adminData();
        $this->assertSame('nonce-kcpw_aa_pick', $d['token']);
        $this->assertSame('kcpw_aa_pick', $d['query']);
        $urls = array_column($d['pages'], 'url');
        $this->assertSame('https://shop.example.test/', $urls[0]);
        $this->assertTrue(in_array('https://shop.example.test/checkout/', $urls, true));
        $this->assertTrue(in_array('https://shop.example.test/page-4/', $urls, true));
        $this->assertFalse(in_array('https://evil.example.test/shop/', $urls, true), 'an address on another site is never offered');
        $this->assertSame(count($urls), count(array_unique($urls)));
        $labels = array_column($d['pages'], 'label');
        $this->assertContains('Checkout (add an item to your cart first)', implode('|', $labels));
    }

    public function testEveryAdminSentenceTheScriptNeedsExists(): void
    {
        $s = Picker::adminStrings();
        foreach (['pick', 'pickTitle', 'pickFor', 'pickHelp', 'pickClose', 'pickPage', 'pickWindow', 'pickWaiting', 'pickUse', 'pickUnique', 'pickMany', 'pickNone', 'pickChosen', 'kind_id', 'kind_name', 'kind_autocomplete', 'kind_data', 'kind_placeholder', 'kind_class', 'kind_path', 'importFile'] as $key) {
            $this->assertTrue(isset($s[$key]) && $s[$key] !== '', $key);
        }
        $this->assertContains('%d', $s['pickMany']);
        $this->assertContains('%s', $s['pickFor']);
    }
}
