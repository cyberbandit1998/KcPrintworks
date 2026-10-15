<?php
declare(strict_types=1);

namespace KcPrintworks\Quotes\Tests;

use KcPrintworks\Quotes\Domain\Status;
use KcPrintworks\Quotes\Wp\WcOrderGateway;

/** The WooCommerce side, end to end over the stand-ins: a quote is requested, quoted, approved, paid; and ordinary orders are left alone. */
final class OrderHooksTest extends TestCase
{
    /** @return array{0:GlueFixtures,1:\KcPrintworks\Quotes\Domain\Quote,2:string,3:string} */
    private function approvedQuote(): array
    {
        $g = GlueFixtures::boot();
        \WpStub::$actions['rest_api_init'][0]();
        $saved = $g->call('POST', '/kcpw-quotes/v1/requests', json_encode(['request' => Fixtures::request(), 'clientKey' => bin2hex(random_bytes(32))]));
        $quote = $g->repo->findByRef($saved->data['ref']);
        $g->admin->sendQuote($quote->id(), ['title' => 'Custom case for Catan', 'details' => '', 'itemCents' => 4500, 'shipCents' => 850, 'expiresAt' => time() + 5 * 86400], 'admin:7');
        preg_match('/token=([A-Za-z0-9_-]{43})/', end(\WpStub::$mail)['message'], $m);
        $answer = $g->call('POST', '/kcpw-quotes/v1/quote/approve', json_encode(['ref' => $quote->ref(), 'token' => $m[1], 'approval' => Fixtures::approval(1)]));
        return [$g, $g->repo->find($quote->id()), $m[1], $answer->data['payUrl']];
    }

    public function testThePluginRegistersExactlyThreeWooCommerceHooksAndNothingElseOfCheckout(): void
    {
        $g = GlueFixtures::boot();
        $this->assertSame(['woocommerce_order_status_changed'], array_values(array_filter(array_keys(\WpStub::$actions), static fn (string $h): bool => str_starts_with($h, 'woocommerce_') && $h !== 'woocommerce_init')));
        $filters = array_keys(\WpStub::$filters);
        sort($filters);
        $this->assertSame(['woocommerce_cancel_unpaid_order', 'woocommerce_order_needs_payment', 'wp_privacy_personal_data_erasers', 'wp_privacy_personal_data_exporters'], $filters);
        $g->cleanup();
    }

    public function testPayingTheOrderMarksTheQuotePaid(): void
    {
        [$g, $quote] = $this->approvedQuote();
        $order = \WpStub::$orders[$quote->orderId()];
        $this->assertSame('pending', $order->status);
        $this->assertTrue($order->needs_payment());
        $order->update_status('processing');
        $after = $g->repo->find($quote->id());
        $this->assertSame(Status::PAID, $after?->status());
        $this->assertFalse($order->needs_payment());
        $mailToOwner = array_values(array_filter(\WpStub::$mail, static fn (array $m): bool => $m['to'] === 'contact@kcprintworks.com' && str_contains($m['subject'], 'paid')));
        $this->assertCount(1, $mailToOwner);
        $g->cleanup();
    }

    public function testChangingTheOrderAfterApprovalStopsItBeingCountedAsPaid(): void
    {
        [$g, $quote] = $this->approvedQuote();
        $order = \WpStub::$orders[$quote->orderId()];
        $order->items['fee'][0]->total = '1.00';
        $order->calculate_totals(false);
        $order->update_status('processing');
        $after = $g->repo->find($quote->id());
        $this->assertSame(Status::APPROVED, $after?->status());
        $this->assertTrue($after?->needsAttention());
        $this->assertTrue(count($order->notes) >= 2, 'a note was left on the order');
        $g->cleanup();
    }

    public function testAQuoteOrderCannotBePaidOnceTheQuoteIsNotApprovedAnymore(): void
    {
        [$g, $quote, $token] = $this->approvedQuote();
        $order = \WpStub::$orders[$quote->orderId()];
        $this->assertTrue($order->needs_payment());
        // Cancelled by the owner through the dashboard's own service: the unpaid order is cancelled, nothing to pay.
        $g->admin->changeStatus($quote->id(), Status::CANCELLED, 'admin:7');
        $this->assertSame('cancelled', $order->status);
        $this->assertFalse($order->needs_payment());

        // The quote moves on by itself while the order is still "pending" (someone reopened the order by hand): still not payable.
        [$g2, $q2] = $this->approvedQuote();
        $o2 = \WpStub::$orders[$q2->orderId()];
        $g2->repo->swap($q2->id(), [], ['status' => Status::EXPIRED], [], time());
        $this->assertFalse($o2->needs_payment(), 'an expired quote\'s order cannot be paid');
        $g2->repo->swap($q2->id(), [], ['status' => Status::APPROVED, 'order_id' => 0], [], time());
        $this->assertFalse($o2->needs_payment(), 'nor one the quote no longer points at');
        $g2->repo->swap($q2->id(), [], ['order_id' => $o2->id, 'pay_by' => time() - 5], [], time());
        $this->assertFalse($o2->needs_payment(), 'nor one past its payment window');
        $g2->repo->swap($q2->id(), [], ['pay_by' => time() + 500], [], time());
        $this->assertTrue($o2->needs_payment(), 'and when everything is in order it can be');
        $g2->repo->swap($q2->id(), [], ['item_cents' => 100], [], time());
        $this->assertFalse($o2->needs_payment(), 'a quote whose amounts changed after the order was made');
        $g->cleanup();
        $g2->cleanup();
    }

    public function testOrdinaryOrdersAndTheNormalCheckoutAreNeverTouched(): void
    {
        $g = GlueFixtures::boot();
        $ordinary = new \WC_Order();
        $ordinary->save();
        $ordinary->add_item(new \WC_Order_Item_Product());
        $this->assertTrue($ordinary->needs_payment(), 'needs payment exactly as WooCommerce says');
        $this->assertTrue(apply_filters('woocommerce_cancel_unpaid_order', true, $ordinary), 'housekeeping still cancels it');
        $this->assertFalse(apply_filters('woocommerce_cancel_unpaid_order', false, $ordinary));
        $ordinary->update_status('processing');
        $ordinary->update_status('cancelled');
        $ordinary->update_status('refunded');
        $this->assertSame(0, array_sum($g->repo->counts()), 'no quote was involved');
        $this->assertSame([], \WpStub::$mail);
        $this->assertSame(true, apply_filters('woocommerce_order_needs_payment', true, 'not an order object', []), 'junk passes through');
        $g->cleanup();
    }

    public function testWooCommerceHousekeepingDoesNotCancelAQuoteOrdersUnpaidOrder(): void
    {
        [$g, $quote] = $this->approvedQuote();
        $order = \WpStub::$orders[$quote->orderId()];
        $this->assertFalse(apply_filters('woocommerce_cancel_unpaid_order', true, $order));
        $g->cleanup();
    }

    public function testCancellingTheOrderInWooCommerceCancelsTheQuoteButRevisingDoesNot(): void
    {
        [$g, $quote] = $this->approvedQuote();
        \WpStub::$orders[$quote->orderId()]->update_status('cancelled');
        $this->assertSame(Status::CANCELLED, $g->repo->find($quote->id())?->status());

        [$g2, $q2] = $this->approvedQuote();
        $outcome = $g2->admin->sendQuote($q2->id(), ['title' => 'Revised case', 'details' => '', 'itemCents' => 6000, 'shipCents' => 0, 'expiresAt' => time() + 86400], 'admin:7');
        $this->assertTrue($outcome->ok, $outcome->message);
        $after = $g2->repo->find($q2->id());
        $this->assertSame(Status::QUOTED, $after?->status(), 'the plugin\'s own cancellation did not cancel the quote');
        $this->assertSame('cancelled', \WpStub::$orders[$q2->orderId()]->status);
        $this->assertSame('plugin', \WpStub::$orders[$q2->orderId()]->meta[WcOrderGateway::META_CLOSED]);
        $g->cleanup();
        $g2->cleanup();
    }

    public function testAHookThatFailsInsideDoesNotBreakWooCommerce(): void
    {
        [$g, $quote] = $this->approvedQuote();
        $order = \WpStub::$orders[$quote->orderId()];
        $g->db->query('DROP TABLE wp_kcpw_quotes'); // the quotes disappear underneath it
        $log = ini_set('error_log', sys_get_temp_dir() . '/kcpw-quotes-test-error.log');
        $order->update_status('processing'); // must not throw
        ini_set('error_log', (string) $log);
        $this->assertSame('processing', $order->status, 'WooCommerce carried on');
        $g->cleanup();
    }
}
