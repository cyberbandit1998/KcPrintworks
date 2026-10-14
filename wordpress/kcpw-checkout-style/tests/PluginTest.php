<?php
declare(strict_types=1);

namespace KcPrintworks\CheckoutStyle\Tests;

use KcPrintworks\CheckoutStyle\Plugin;
use WpStub;

final class PluginTest extends TestCase
{
    private const FILE = __DIR__ . '/../kcpw-checkout-style.php';

    /** @param array<string, mixed> $config */
    private function boot(array $config = []): Plugin
    {
        $plugin = new Plugin(self::FILE, '0.1.0', $config + ['mode' => 'on', 'pageId' => 9, 'storefront' => 'https://kcprintworks.com', 'hide' => []]);
        $plugin->register();
        return $plugin;
    }

    private function visit(int $pageId): void
    {
        WpStub::$currentPageId = $pageId;
        WpStub::run('wp');
    }

    public function testOffRegistersNothingAtAll(): void
    {
        $this->boot(['mode' => 'off']);
        $this->assertSame([], WpStub::$actions);
        $this->assertSame([], WpStub::$filters);
    }

    public function testOtherPagesGetNothing(): void
    {
        $plugin = $this->boot();
        $this->visit(12);
        $this->assertFalse($plugin->isActive());
        $this->assertSame(['wp'], array_keys(WpStub::$actions));
        $this->assertSame([], WpStub::$filters);
        $this->assertSame([], WpStub::$enqueued);
    }

    public function testCheckoutPageGetsTheBodyClassTheStylesheetAndTheHeader(): void
    {
        $plugin = $this->boot();
        $this->visit(9);
        $this->assertTrue($plugin->isActive());
        $this->assertSame(['old', 'kcpw-checkout'], WpStub::filter('body_class', ['old']));
        WpStub::run('wp_enqueue_scripts');
        $this->assertSame(1, count(WpStub::$enqueued));
        $this->assertSame('kcpw-checkout-style', WpStub::$enqueued[0]['handle']);
        $this->assertSame('https://shop.example.com/wp-content/plugins/kcpw-checkout-style/assets/checkout.css', WpStub::$enqueued[0]['src']);
        $this->assertSame((string) filemtime(__DIR__ . '/../assets/checkout.css'), WpStub::$enqueued[0]['ver']);
        $this->assertContains('class="kcpw-co-header"', WpStub::run('wp_body_open'));
    }

    public function testOnlyTheConfiguredPageIsStyled(): void
    {
        $plugin = $this->boot(['pageId' => 77]);
        $this->visit(9);
        $this->assertFalse($plugin->isActive());
        $this->visit(77);
        $this->assertTrue($plugin->isActive());
    }

    public function testAdminsModeShowsItToAdministratorsOnly(): void
    {
        $plugin = $this->boot(['mode' => 'admins']);
        WpStub::$isAdmin = false;
        $this->visit(9);
        $this->assertFalse($plugin->isActive(), 'customers see the page exactly as before');
        $this->assertSame([], WpStub::$filters);

        WpStub::reset();
        $plugin = $this->boot(['mode' => 'admins']);
        WpStub::$isAdmin = true;
        $this->visit(9);
        $this->assertTrue($plugin->isActive());
    }

    public function testTheStylesheetWaitsForThemeAndBlocksStylesOnlyWhenTheyExist(): void
    {
        $this->boot();
        $this->visit(9);
        WpStub::run('wp_enqueue_scripts');
        $this->assertSame([], WpStub::$enqueued[0]['deps'], 'a missing dependency would stop the stylesheet from printing at all');

        WpStub::reset();
        WpStub::$registeredStyles = ['astra-theme-css', 'wc-blocks-style'];
        $this->boot();
        $this->visit(9);
        WpStub::run('wp_enqueue_scripts');
        $this->assertSame(['astra-theme-css', 'wc-blocks-style'], WpStub::$enqueued[0]['deps']);
    }

    public function testTheThemeHeaderAndStoreNoticeAreHiddenTogetherWithTheCompactHeader(): void
    {
        $this->boot(['hide' => ['.old-promo']]);
        $this->visit(9);
        $out = WpStub::run('wp_body_open');
        $this->assertContains('<style id="kcpw-checkout-chrome">', $out);
        foreach (['#masthead', '.woocommerce-store-notice', 'p.demo_store', '.old-promo'] as $selector) {
            $this->assertContains('body.kcpw-checkout ' . $selector, $out, $selector);
        }
        $this->assertContains('{display:none!important}', $out);
        $this->assertTrue(strpos($out, '<style') < strpos($out, '<header'), 'the rule comes with the header it makes room for');
    }

    public function testTheStoreNoticeMarkupIsEmptiedOnThisPageOnly(): void
    {
        $this->boot();
        $this->assertSame([], WpStub::$filters);
        $this->visit(9);
        $this->assertSame('', WpStub::filter('woocommerce_demo_store', '<p class="demo_store">Free shipping</p>'));
    }

    public function testLinksPointAtTheStorefrontWhenItIsConfigured(): void
    {
        $this->boot();
        $this->visit(9);
        $out = WpStub::run('wp_body_open');
        $this->assertContains('href="https://kcprintworks.com/"', $out);
        $this->assertContains('href="https://kcprintworks.com/cart/"', $out);
        $this->assertNotContains('shop.example.com', $out);
    }

    public function testWithoutAStorefrontTheLinksStayOnTheShop(): void
    {
        $this->boot(['storefront' => '']);
        $this->visit(9);
        $out = WpStub::run('wp_body_open');
        $this->assertContains('href="https://shop.example.com/"', $out);
        $this->assertContains('href="https://shop.example.com/cart/"', $out);
    }

    public function testTheConfirmationPageGetsTheConfirmationHeader(): void
    {
        $this->boot();
        WpStub::$orderReceived = true;
        $this->visit(9);
        $out = WpStub::run('wp_body_open');
        $this->assertContains('Order confirmation', $out);
        $this->assertContains('href="https://kcprintworks.com/shop/"', $out);
    }

    public function testItAddsOnlyHooksThatAreNeededForStyling(): void
    {
        $this->boot();
        $this->visit(9);
        $this->assertSame(['wp', 'wp_enqueue_scripts', 'wp_body_open'], array_keys(WpStub::$actions));
        $this->assertSame(['body_class', 'woocommerce_demo_store'], array_keys(WpStub::$filters));
    }

    public function testThePluginCodeCannotTouchPaymentsOrderDataOrTheNetwork(): void
    {
        $forbidden = ['register_rest_route', 'wp_ajax', 'wp_redirect', 'wp_safe_redirect', 'header(', 'template_redirect', 'update_option', 'add_option',
            'delete_option', 'update_post_meta', 'wpdb', 'wp_remote_', 'curl_', 'file_get_contents', 'wp_enqueue_script(', '<script', 'WC()', 'wc_create_order',
            'woocommerce_checkout', 'woocommerce_cart', 'woocommerce_payment', 'woocommerce_available_payment_gateways', 'kcpw_handoff', 'KcPrintworks\\Core',
            'remove_action', 'remove_filter', 'eval(', 'exec(', 'unserialize'];
        foreach (array_merge(glob(dirname(__DIR__) . '/src/*.php') ?: [], [dirname(__DIR__) . '/kcpw-checkout-style.php']) as $file) {
            $code = (string) file_get_contents($file);
            // Comments explain what the plugin does NOT do, so only code is scanned.
            $code = (string) preg_replace('#/\*.*?\*/#s', '', $code);
            $code = (string) preg_replace('#^\s*//.*$#m', '', $code);
            foreach ($forbidden as $needle) {
                $this->assertNotContains($needle, $code, basename($file) . ' contains ' . $needle);
            }
        }
    }
}
