<?php
declare(strict_types=1);

namespace KcPrintworks\AddressAutocomplete\Tests;

use KcPrintworks\AddressAutocomplete\Settings;
use KcPrintworks\AddressAutocomplete\Usage;
use KcPrintworks\AddressAutocomplete\WooCommerce;

final class WooCommerceTest extends TestCase
{
    private function woo(array $override = []): WooCommerce
    {
        return new WooCommerce(Settings::load($override + ['mode' => 'live', 'browser_key' => 'BrowserKeyBrowserKeyBrowserKey01']));
    }

    private function errors(): object
    {
        return new class () {
            /** @var list<string> */
            public array $added = [];
            public function add(string $code, string $message): void
            {
                $this->added[] = $code;
            }
        };
    }

    private function block(array $more = []): array
    {
        return $more + ['modules' => ['pobox' => true], 'pobox_mode' => 'block'];
    }

    public function testHooksAreRegisteredButDoNothingByDefault(): void
    {
        $this->woo()->register();
        foreach (['woocommerce_thankyou', 'woocommerce_after_checkout_validation', 'woocommerce_store_api_checkout_update_order_from_request'] as $hook) {
            $this->assertTrue(isset(\WpStub::$actions[$hook]), $hook);
        }
        $e = $this->errors();
        $this->woo()->classicValidation(['billing_address_1' => 'PO Box 5'], $e);
        $this->assertSame([], $e->added, 'warn mode never stops an order');
        $this->woo(['modules' => ['pobox' => true]])->classicValidation(['billing_address_1' => 'PO Box 5'], $e);
        $this->assertSame([], $e->added);
    }

    public function testBlockModeStopsAPoBoxOnTheClassicCheckoutOnlyWhenLive(): void
    {
        $e = $this->errors();
        $this->woo($this->block())->classicValidation(['billing_address_1' => 'P.O. Box 5'], $e);
        $this->assertSame(['kcpw_aa_pobox'], $e->added);

        $e = $this->errors();
        $this->woo($this->block(['mode' => 'preview']))->classicValidation(['billing_address_1' => 'PO Box 5'], $e);
        $this->assertSame([], $e->added, 'customers are not part of a preview');
    }

    public function testItChecksTheAddressTheOrderWillBeShippedTo(): void
    {
        $e = $this->errors();
        $woo = $this->woo($this->block());
        $woo->classicValidation(['billing_address_1' => 'PO Box 5', 'ship_to_different_address' => '1', 'shipping_address_1' => '12 Main Street'], $e);
        $this->assertSame([], $e->added, 'a PO box as the BILLING address is fine when shipping elsewhere');
        $woo->classicValidation(['billing_address_1' => '12 Main Street', 'ship_to_different_address' => '1', 'shipping_address_1' => '1 Elm', 'shipping_address_2' => 'PO Box 9'], $e);
        $this->assertSame(['kcpw_aa_pobox'], $e->added, 'a PO box on the second line counts');
    }

    public function testMilitaryAddressesAreNeverBlocked(): void
    {
        $e = $this->errors();
        $this->woo($this->block())->classicValidation(['billing_address_1' => 'PSC 1234 Box 5678', 'billing_address_2' => 'APO AE 09012'], $e);
        $this->assertSame([], $e->added);
    }

    public function testHostileOrMissingInputNeverThrowsOrBlocks(): void
    {
        $woo = $this->woo($this->block());
        $woo->classicValidation('nope', 'nope');
        $woo->classicValidation(null, null);
        $woo->classicValidation([], new \stdClass());
        $woo->storeApi('nope', null);
        $woo->storeApi(new \stdClass(), null);
        $this->assertTrue(true);
    }

    public function testTheStoreApiRefusesAPoBoxWithTheDocumentedExceptionOnlyWhenBlocking(): void
    {
        $order = new class () {
            public function get_shipping_address_1(): string
            {
                return 'PO Box 77';
            }
            public function get_shipping_address_2(): string
            {
                return '';
            }
        };
        // Without WooCommerce's exception class there is nothing safe to throw: the order goes through.
        $this->woo($this->block())->storeApi($order, null);
        $this->woo()->storeApi($order, null);
        eval('namespace Automattic\WooCommerce\StoreApi\Exceptions { if (!class_exists(RouteException::class)) { class RouteException extends \Exception { public function __construct(string $code, string $message, int $status) { parent::__construct($message, $status); } } } }');
        $this->woo()->storeApi($order, null);
        $this->assertThrows(fn () => $this->woo($this->block())->storeApi($order, null), 'PO box');
        $ok = new class () {
            public function get_shipping_address_1(): string
            {
                return '12 Main Street';
            }
            public function get_shipping_address_2(): string
            {
                return '';
            }
        };
        $this->woo($this->block())->storeApi($ok, null);
    }

    public function testFinishedOrdersAreCountedOnlyWithTheOptInAndOnlyOncePerOrder(): void
    {
        $this->woo()->completed(101);
        $this->assertSame([], \WpStub::$options, 'off by default');
        $on = $this->woo(['optins' => ['abandonment' => ['enabled' => true]]]);
        $on->completed(101);
        $on->completed(101);
        $on->completed('102');
        $on->completed(0);
        $on->completed('abc');
        $this->assertSame(2, \WpStub::$options[Usage::OPTION]['days'][gmdate('Y-m-d')]['cc'], 'a reloaded thank-you page does not count twice');
        $this->assertNotContains('@', (string) json_encode(\WpStub::$options), 'a number, nothing about the order');
        $preview = $this->woo(['mode' => 'preview', 'optins' => ['abandonment' => ['enabled' => true]]]);
        $preview->completed(103);
        $this->assertSame(2, \WpStub::$options[Usage::OPTION]['days'][gmdate('Y-m-d')]['cc'], 'nothing counted in preview');
    }
}
