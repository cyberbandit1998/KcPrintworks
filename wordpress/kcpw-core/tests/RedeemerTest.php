<?php
declare(strict_types=1);

namespace KcPrintworks\Core\Tests;

use KcPrintworks\Core\Handoff\HandoffRequest;
use KcPrintworks\Core\Handoff\MemoryHandoffStore;
use KcPrintworks\Core\Wp\Redeemer;

final class RedeemerTest extends TestCase
{
    private function redirectOf(callable $work): string
    {
        try {
            $work();
        } catch (\WpStubStop $stop) {
            $this->assertSame('redirect', $stop->kind);
            return $stop->detail;
        }
        throw new \RuntimeException('expected a redirect');
    }

    public function testASuccessfulHandoffBuildsTheCartAndGoesToCheckout(): void
    {
        \WpStub::reset();
        $service = GlueFixtures::service();
        $body = '{"lines":[{"productId":11,"quantity":2,"options":{"name":"Robin","gift":true}},{"productId":30,"variationId":301,"quantity":1,"attributes":{"tag-color":"navy","text-color":"red"},"options":{"name":"Sam"}}]}';
        $this->assertSame('ok', $service->create(HandoffRequest::parse($body)->lines)->status);

        $_GET['kcpw_handoff'] = GlueFixtures::token(1);
        $redeemer = new Redeemer($service);
        $url = $this->redirectOf(fn () => $redeemer->maybeRedeem());
        $this->assertSame('https://shop.example.com/checkout/', $url);

        $cart = \WpStub::$cart;
        $this->assertSame(1, $cart->emptied, 'the cart was emptied once, before anything was added');
        $this->assertSame(1, $cart->couponsRemoved);
        $this->assertCount(2, $cart->added);
        $first = $cart->added[0];
        $this->assertSame([11, 2, 0, []], [$first['productId'], $first['quantity'], $first['variationId'], $first['variation']]);
        $this->assertSame(['name' => 'Robin', 'gift' => true], $first['data']['kcpw']['options']);
        $this->assertSame('Robin', $first['data']['kcpw']['summary'][0]['value']);
        $second = $cart->added[1];
        $this->assertSame(301, $second['variationId']);
        $this->assertSame(['attribute_tag-color' => 'Navy', 'attribute_text-color' => 'Red'], $second['variation']);
        $this->assertTrue(\WpStub::$session->cookie, 'the shopper gets a session cookie so the cart follows them');
        $this->assertFalse(\KcPrintworks\Core\Wp\CartHooks::$building, 'the building flag is always cleared');
    }

    public function testReloadingTheLinkInTheSameSessionGoesStraightToCheckoutWithoutRebuilding(): void
    {
        \WpStub::reset();
        $service = GlueFixtures::service();
        $service->create(HandoffRequest::parse('{"lines":[{"productId":10,"quantity":1}]}')->lines);
        $_GET['kcpw_handoff'] = GlueFixtures::token(1);
        $redeemer = new Redeemer($service);
        $this->redirectOf(fn () => $redeemer->maybeRedeem());
        $added = count(\WpStub::$cart->added);
        $url = $this->redirectOf(fn () => $redeemer->maybeRedeem());
        $this->assertSame('https://shop.example.com/checkout/', $url);
        $this->assertSame($added, count(\WpStub::$cart->added), 'nothing was added a second time');
    }

    public function testAnotherBrowserCannotReuseTheLink(): void
    {
        \WpStub::reset();
        $service = GlueFixtures::service();
        $service->create(HandoffRequest::parse('{"lines":[{"productId":10,"quantity":1}]}')->lines);
        $_GET['kcpw_handoff'] = GlueFixtures::token(1);
        $redeemer = new Redeemer($service);
        $this->redirectOf(fn () => $redeemer->maybeRedeem());
        \WpStub::$session = new \WC_Session(); // a different shopper, no session memory
        \WpStub::$cart = new \WC_Cart();
        $url = $this->redirectOf(fn () => $redeemer->maybeRedeem());
        $this->assertSame('https://staging.example.com/cart/?handoff=expired', $url);
        $this->assertCount(0, \WpStub::$cart->added);
    }

    public function testBadTokensGoBackToTheStorefrontCart(): void
    {
        \WpStub::reset();
        $redeemer = new Redeemer(GlueFixtures::service());
        foreach (['garbage', '', str_repeat('a', 43)] as $token) {
            $_GET['kcpw_handoff'] = $token;
            $this->assertSame('https://staging.example.com/cart/?handoff=expired', $this->redirectOf(fn () => $redeemer->maybeRedeem()), $token);
        }
        $this->assertCount(0, \WpStub::$cart->added);
    }

    public function testIfTheCatalogChangedMeanwhileTheShopperIsToldNotSilentlyGivenSomethingElse(): void
    {
        \WpStub::reset();
        $products = GlueFixtures::vectorProducts();
        $service = GlueFixtures::service($products, new MemoryHandoffStore());
        $service->create(HandoffRequest::parse('{"lines":[{"productId":12,"quantity":3}]}')->lines);
        // Stock drops from 3 to 2 while they wait.
        $limited = $products->find(12);
        $products->add(new \KcPrintworks\Core\Catalog\ProductModel(
            12, 'simple', $limited->name, 'USD', $limited->priceCents, [], [], $limited->schema, true, 'instock', 2, false,
        ));
        $_GET['kcpw_handoff'] = GlueFixtures::token(1);
        $url = $this->redirectOf(fn () => (new Redeemer($service))->maybeRedeem());
        $this->assertSame('https://staging.example.com/cart/?handoff=changed', $url);
        $this->assertCount(0, \WpStub::$cart->added);
    }

    public function testIfWooCommerceRefusesALineTheWholeCartIsEmptiedAndTheShopperIsSentBack(): void
    {
        \WpStub::reset();
        $service = GlueFixtures::service();
        $service->create(HandoffRequest::parse('{"lines":[{"productId":10,"quantity":1}]}')->lines);
        \WpStub::$cart->failNext = true;
        $_GET['kcpw_handoff'] = GlueFixtures::token(1);
        $url = $this->redirectOf(fn () => (new Redeemer($service))->maybeRedeem());
        $this->assertSame('https://staging.example.com/cart/?handoff=unavailable', $url);
        $this->assertCount(0, \WpStub::$cart->contents);
        $this->assertFalse(\KcPrintworks\Core\Wp\CartHooks::$building);
    }

    public function testDoesNothingWithoutTheQueryArgument(): void
    {
        \WpStub::reset();
        (new Redeemer(GlueFixtures::service()))->maybeRedeem();
        $this->assertCount(0, \WpStub::$cart->added);
        $this->assertSame(0, \WpStub::$cart->emptied);
    }
}
