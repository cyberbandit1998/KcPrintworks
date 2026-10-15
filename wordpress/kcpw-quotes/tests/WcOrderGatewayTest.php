<?php
declare(strict_types=1);

namespace KcPrintworks\Quotes\Tests;

use KcPrintworks\Quotes\Domain\Quote;
use KcPrintworks\Quotes\Service\OrderFailed;
use KcPrintworks\Quotes\Wp\WcOrderGateway;

final class WcOrderGatewayTest extends TestCase
{
    private function quote(array $over = []): Quote
    {
        return Quote::fromRow(\KcPrintworks\Quotes\Repo\Rows::build(42, $over + [
            'ref' => 'KCQ-2610-ABCDEF', 'status' => 'approved', 'name' => 'Robin van Hood', 'email' => 'robin@example.com', 'quote_title' => 'Custom case for Catan',
            'item_cents' => 4500, 'ship_cents' => 850, 'currency' => 'USD', 'revision' => 1,
        ]));
    }

    private function address(): array
    {
        return ['line1' => '12 Main Street', 'line2' => 'Apt 4', 'city' => 'Flint', 'state' => 'MI', 'postcode' => '48503', 'country' => 'US', 'phone' => '+1 810 555 0100'];
    }

    public function testItMakesAPendingGuestOrderWithOneFeeLineOneShippingLineAndTheQuoteOnIt(): void
    {
        \WpStub::reset();
        $gateway = new WcOrderGateway();
        $ref = $gateway->createPendingOrder($this->quote(), $this->address(), str_repeat('f', 64));
        $order = \WpStub::$orders[$ref->orderId];
        $this->assertSame('pending', $order->status);
        $this->assertSame('kcpw-quotes', $order->meta['_created_via']);
        $this->assertSame('USD', $order->currency);
        $this->assertSame('42', $order->meta['_kcpw_quote_id']);
        $this->assertSame('KCQ-2610-ABCDEF', $order->meta['_kcpw_quote_ref']);
        $this->assertSame(str_repeat('f', 64), $order->meta['_kcpw_quote_fp']);
        $this->assertCount(1, $order->items['fee']);
        $this->assertCount(1, $order->items['shipping']);
        $this->assertCount(0, $order->items['line_item'], 'never a product');
        $this->assertSame('45.00', $order->items['fee'][0]->total);
        $this->assertSame('8.50', $order->items['shipping'][0]->total);
        $this->assertStringContains('KCQ-2610-ABCDEF', $order->items['fee'][0]->name);
        $this->assertSame('none', $order->items['fee'][0]->taxStatus);
        $this->assertSame('53.50', $order->total);
        $this->assertSame('0.00', $order->totalTax);
        $this->assertSame('Robin', $order->fields['billing_first_name']);
        $this->assertSame('van Hood', $order->fields['billing_last_name']);
        $this->assertSame('robin@example.com', $order->fields['billing_email']);
        $this->assertSame('12 Main Street', $order->fields['shipping_address_1']);
        $this->assertSame('US', $order->fields['billing_country']);
        $this->assertSame($order->get_checkout_payment_url(), $ref->payUrl);
        $this->assertTrue(count($order->notes) >= 1);
    }

    public function testFreeShippingMakesNoShippingLine(): void
    {
        \WpStub::reset();
        $ref = (new WcOrderGateway())->createPendingOrder($this->quote(['ship_cents' => 0]), $this->address(), str_repeat('f', 64));
        $this->assertCount(0, \WpStub::$orders[$ref->orderId]->items['shipping']);
        $this->assertSame('45.00', \WpStub::$orders[$ref->orderId]->total);
    }

    public function testATaxableQuoteLetsWooCommerceAddTaxToTheLines(): void
    {
        \WpStub::reset();
        $ref = (new WcOrderGateway())->createPendingOrder($this->quote(['taxable' => 1]), $this->address(), str_repeat('f', 64));
        $order = \WpStub::$orders[$ref->orderId];
        $this->assertSame('taxable', $order->items['fee'][0]->taxStatus);
        $this->assertSame('58.85', $order->total, 'the stand-in store adds 10%');
        $facts = (new WcOrderGateway())->inspect($ref->orderId);
        $this->assertSame(4500, $facts?->feeCents);
        $this->assertSame(850, $facts?->shippingCents);
        $this->assertSame(535, $facts?->taxCents);
        $this->assertSame(5885, $facts?->totalCents);
    }

    public function testInspectReportsWhatTheOrderReallyIsIncludingExtrasAnyoneAdded(): void
    {
        \WpStub::reset();
        $gateway = new WcOrderGateway();
        $ref = $gateway->createPendingOrder($this->quote(), $this->address(), str_repeat('a', 64));
        $facts = $gateway->inspect($ref->orderId);
        $this->assertSame(42, $facts?->quoteId);
        $this->assertSame(str_repeat('a', 64), $facts?->fingerprint);
        $this->assertSame(0, $facts?->otherLines);
        $this->assertSame('USD', $facts?->currency);
        $this->assertFalse($facts?->closedByPlugin);

        $order = \WpStub::$orders[$ref->orderId];
        $order->add_item(new \WC_Order_Item_Product());
        $second = new \WC_Order_Item_Fee();
        $second->set_total('5.00');
        $order->add_item($second);
        $facts = $gateway->inspect($ref->orderId);
        $this->assertSame(2, $facts?->otherLines, 'a product and a second fee');
        $this->assertSame(5000, $facts?->feeCents);
        $this->assertNull($gateway->inspect(999999));
        $ordinary = new \WC_Order();
        $ordinary->id = 9;
        \WpStub::$orders[9] = $ordinary;
        $this->assertSame(0, $gateway->inspect(9)?->quoteId);
    }

    public function testAnOrderForTheQuoteIsFoundAgainButACancelledOneIsNot(): void
    {
        \WpStub::reset();
        $gateway = new WcOrderGateway();
        $this->assertNull($gateway->findByQuote(42));
        $ref = $gateway->createPendingOrder($this->quote(), $this->address(), str_repeat('f', 64));
        $this->assertSame($ref->orderId, $gateway->findByQuote(42)?->orderId);
        $this->assertNull($gateway->findByQuote(43));
        \WpStub::$orders[$ref->orderId]->status = 'cancelled';
        $this->assertNull($gateway->findByQuote(42));
    }

    public function testPayUrlOnlyForAnUnpaidQuoteOrder(): void
    {
        \WpStub::reset();
        $gateway = new WcOrderGateway();
        $ref = $gateway->createPendingOrder($this->quote(), $this->address(), str_repeat('f', 64));
        $this->assertStringContains('/order-pay/', (string) $gateway->payUrl($ref->orderId));
        \WpStub::$orders[$ref->orderId]->status = 'processing';
        $this->assertNull($gateway->payUrl($ref->orderId));
        $this->assertNull($gateway->payUrl(424242));
        $ordinary = new \WC_Order();
        $ordinary->id = 9;
        \WpStub::$orders[9] = $ordinary;
        $this->assertNull($gateway->payUrl(9), 'never hands out the address of an order that is not a quote order');
    }

    public function testCancellingTouchesOnlyUnpaidOrdersAndMarksItselfAsTheCauser(): void
    {
        \WpStub::reset();
        $gateway = new WcOrderGateway();
        $ref = $gateway->createPendingOrder($this->quote(), $this->address(), str_repeat('f', 64));
        $this->assertSame('cancelled', $gateway->cancelUnpaid($ref->orderId, 'Because'));
        $order = \WpStub::$orders[$ref->orderId];
        $this->assertSame('cancelled', $order->status);
        $this->assertSame('plugin', $order->meta['_kcpw_quote_closed']);
        $this->assertTrue($gateway->inspect($ref->orderId)?->closedByPlugin);
        $this->assertSame('already_cancelled', $gateway->cancelUnpaid($ref->orderId, 'Again'));
        $this->assertSame('missing', $gateway->cancelUnpaid(777777, 'x'));

        foreach (['processing', 'completed', 'refunded', 'on-hold'] as $paid) {
            $r = $gateway->createPendingOrder($this->quote(), $this->address(), str_repeat('f', 64));
            \WpStub::$orders[$r->orderId]->status = $paid;
            $this->assertSame('paid', $gateway->cancelUnpaid($r->orderId, 'x'), $paid);
            $this->assertSame($paid, \WpStub::$orders[$r->orderId]->status, "$paid is left alone");
        }
        $weird = $gateway->createPendingOrder($this->quote(), $this->address(), str_repeat('f', 64));
        \WpStub::$orders[$weird->orderId]->status = 'checkout-draft';
        $this->assertSame('failed', $gateway->cancelUnpaid($weird->orderId, 'x'));
    }

    public function testMoneyTextBecomesCentsWithoutFloats(): void
    {
        $this->assertSame(4500, WcOrderGateway::cents('45.00'));
        $this->assertSame(4500, WcOrderGateway::cents('45'));
        $this->assertSame(-300, WcOrderGateway::cents('-3.00'));
        $this->assertSame(1999, WcOrderGateway::cents('19.99'));
        $this->assertSame(0, WcOrderGateway::cents('0.00'));
        $this->assertTrue(WcOrderGateway::cents('abc') < -1_000_000_000_000, 'unreadable never equals a real amount');
    }

    public function testWhenWooCommerceCannotMakeTheOrderTheCallerGetsOrderFailed(): void
    {
        \WpStub::reset();
        \WpStub::$failCreateOrder = true;
        $this->assertThrows(OrderFailed::class, fn () => (new WcOrderGateway())->createPendingOrder($this->quote(), $this->address(), 'x'));
        $this->assertSame([], \WpStub::$orders, 'and nothing was left behind');
    }
}
