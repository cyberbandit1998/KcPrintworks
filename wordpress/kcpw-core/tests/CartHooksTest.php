<?php
declare(strict_types=1);

namespace KcPrintworks\Core\Tests;

use KcPrintworks\Core\Wp\CartHooks;

final class CartHooksTest extends TestCase
{
    private const SCHEMA = '{"version":1,"fields":[{"id":"name","type":"text","label":"Name","required":true,"minLength":1,"maxLength":12},{"id":"gift","type":"checkbox","label":"Gift wrap","priceEffect":{"kind":"flat","amount":400}},{"id":"rush","type":"checkbox","label":"Rush","priceEffect":{"kind":"percent","basisPoints":1500}}]}';

    private function cartItem(\WC_Product $product, array $options): array
    {
        return [
            'product_id' => $product->get_id(),
            'variation_id' => 0,
            'data' => $product,
            'kcpw' => ['options' => $options, 'summary' => [['fieldId' => 'name', 'label' => 'Name', 'value' => (string) ($options['name'] ?? '')]], 'schemaVersion' => 1],
        ];
    }

    public function testRegistersTheHooksItNeeds(): void
    {
        \WpStub::reset();
        (new CartHooks())->register();
        foreach (['woocommerce_add_to_cart_validation', 'woocommerce_get_item_data'] as $filter) {
            $this->assertTrue(isset(\WpStub::$filters[$filter]), $filter);
        }
        foreach (['woocommerce_before_calculate_totals', 'woocommerce_check_cart_items', 'woocommerce_checkout_create_order_line_item'] as $action) {
            $this->assertTrue(isset(\WpStub::$actions[$action]), $action);
        }
    }

    public function testOptionChargesAreRecomputedFromTheSchemaAndNeverAccumulate(): void
    {
        \WpStub::reset();
        $product = GlueFixtures::product(11, 'Name Tag', '8.99', ['_kcpw_option_schema' => self::SCHEMA]);
        $cart = new \WC_Cart();
        // The cart holds its own copy of the product (WooCommerce loads a separate object for the cart).
        $inCart = clone $product;
        $item = $this->cartItem($inCart, ['name' => 'Robin', 'gift' => true, 'rush' => true]);
        $cart->contents = ['k' => $item];
        $hooks = new CartHooks();
        $hooks->applyOptionCharges($cart);
        // base 899 + gift 400 + 15% of 899 (134.85 -> 135) = 1434
        $this->assertSame('14.34', $inCart->priceSets[0]);
        // WooCommerce can calculate totals several times in one request; the price must not grow.
        $hooks->applyOptionCharges($cart);
        $hooks->applyOptionCharges($cart);
        $this->assertSame(['14.34', '14.34', '14.34'], $inCart->priceSets);
        $this->assertSame('8.99', $product->price, 'the catalog price itself is untouched');
    }

    public function testATamperedCartItemCannotChangeThePrice(): void
    {
        \WpStub::reset();
        $product = GlueFixtures::product(11, 'Name Tag', '8.99', ['_kcpw_option_schema' => self::SCHEMA]);
        $cart = new \WC_Cart();
        $inCart = clone $product;
        $item = $this->cartItem($inCart, ['name' => 'Robin']);
        $item['kcpw']['unit_price'] = 1;     // anything extra in the item is ignored
        $item['kcpw']['summary'][] = ['fieldId' => 'x', 'label' => 'Free', 'value' => '-9999'];
        $cart->contents = ['k' => $item];
        (new CartHooks())->applyOptionCharges($cart);
        $this->assertSame('8.99', $inCart->priceSets[0]);
    }

    public function testShowsTheChoicesInTheCartEscaped(): void
    {
        \WpStub::reset();
        $product = GlueFixtures::product(11, 'Name Tag');
        $rows = (new CartHooks())->itemData([['key' => 'Size', 'value' => 'M']], $this->cartItem($product, ['name' => '<img src=x onerror=alert(1)>']));
        $this->assertCount(2, $rows);
        $this->assertSame('Name', $rows[1]['key']);
        $this->assertStringNotContains('<img', $rows[1]['display']);
        $this->assertStringContains('&lt;img', $rows[1]['display']);
        $this->assertSame([['key' => 'Size', 'value' => 'M']], (new CartHooks())->itemData([['key' => 'Size', 'value' => 'M']], ['product_id' => 1]));
    }

    public function testSavesReadableLinesAndOneHiddenRecordOnTheOrderItem(): void
    {
        \WpStub::reset();
        $product = GlueFixtures::product(11, 'Name Tag');
        $item = new \WC_Order_Item_Product();
        (new CartHooks())->saveOnOrderItem($item, 'k', $this->cartItem($product, ['name' => 'Zoë ☃']), new \WC_Order());
        $this->assertSame('Name', $item->meta[0][0]);
        $this->assertSame('Zoë ☃', $item->meta[0][1]);
        $this->assertSame('_kcpw_personalization', $item->meta[1][0], 'underscore: hidden in the admin');
        $record = json_decode($item->meta[1][1], true);
        $this->assertSame(['name' => 'Zoë ☃'], $record['values']);
        $this->assertSame(1, $record['v']);

        $none = new \WC_Order_Item_Product();
        (new CartHooks())->saveOnOrderItem($none, 'k', ['product_id' => 1], new \WC_Order());
        $this->assertCount(0, $none->meta, 'a line without personalization gets no extra meta');
    }

    public function testAPersonalizedProductCanOnlyBeAddedByTheValidatedHandoff(): void
    {
        \WpStub::reset();
        GlueFixtures::product(11, 'Name Tag', '8.99', ['_kcpw_option_schema' => self::SCHEMA]);
        GlueFixtures::product(12, 'Plain', '5.00');
        GlueFixtures::product(13, 'Optional only', '5.00', ['_kcpw_option_schema' => '{"version":1,"fields":[{"id":"note","type":"text","label":"Note","maxLength":10}]}']);
        GlueFixtures::product(14, 'Broken', '5.00', ['_kcpw_option_schema' => 'not json']);
        $hooks = new CartHooks();
        $this->assertFalse($hooks->refuseUnpersonalized(true, 11, 1), 'required fields: refused from a normal add-to-cart');
        $this->assertTrue(\WpStub::$notices !== []);
        $this->assertTrue($hooks->refuseUnpersonalized(true, 12, 1));
        $this->assertTrue($hooks->refuseUnpersonalized(true, 13, 1), 'only optional fields: a plain add is a valid empty personalization');
        $this->assertFalse($hooks->refuseUnpersonalized(true, 14, 1), 'a broken setup is never sold');
        $this->assertFalse($hooks->refuseUnpersonalized(false, 12, 1), 'never overrides another refusal');
        CartHooks::$building = true;
        $this->assertTrue($hooks->refuseUnpersonalized(true, 11, 1), 'the handoff may add it');
        CartHooks::$building = false;
    }

    public function testCheckoutIsBlockedWhenPersonalizationNoLongerValidates(): void
    {
        \WpStub::reset();
        $product = GlueFixtures::product(11, 'Name Tag', '8.99', ['_kcpw_option_schema' => self::SCHEMA]);
        \WpStub::$cart->contents = ['ok' => $this->cartItem($product, ['name' => 'Robin'])];
        (new CartHooks())->recheckCart();
        $this->assertCount(0, \WpStub::$notices, 'a valid line raises nothing');

        \WpStub::$cart->contents = ['bad' => $this->cartItem($product, ['name' => 'This name is far too long'])];
        (new CartHooks())->recheckCart();
        $this->assertCount(1, \WpStub::$notices);
        $this->assertSame('error', \WpStub::$notices[0][0]);

        \WpStub::$notices = [];
        \WpStub::$cart->contents = ['missing' => ['product_id' => 11, 'variation_id' => 0, 'data' => $product]];
        (new CartHooks())->recheckCart();
        $this->assertCount(1, \WpStub::$notices, 'a line that lost its personalization is blocked');
    }
}
