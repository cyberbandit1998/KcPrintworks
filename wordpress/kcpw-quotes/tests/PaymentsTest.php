<?php
declare(strict_types=1);

namespace KcPrintworks\Quotes\Tests;

use KcPrintworks\Quotes\Domain\Status;
use KcPrintworks\Quotes\Service\Settings;

final class PaymentsTest extends TestCase
{
    /** @return array{0:Fixtures,1:\KcPrintworks\Quotes\Domain\Quote,2:string,3:int} a shop with one approved quote and its pending order */
    private function approved(?Fixtures $f = null): array
    {
        $f ??= new Fixtures();
        [$quote, $token] = $f->sentQuote();
        $f->customer()->approve($quote->ref(), $token, Fixtures::json(Fixtures::approval(1)));
        $after = $f->repo->find($quote->id());
        $f->mailer->sent = [];
        return [$f, $after, $token, (int) $after?->orderId()];
    }

    public function testPaymentMovesTheQuoteToPaidAndTellsTheOwnerOnce(): void
    {
        [$f, $quote, , $orderId] = $this->approved();
        $f->orders->pay($orderId);
        $outcome = $f->payments()->onOrderPaid($orderId);
        $this->assertTrue($outcome->ok);
        $this->assertSame('paid', $outcome->code);
        $after = $f->repo->find($quote->id());
        $this->assertSame(Status::PAID, $after?->status());
        $this->assertSame(Fixtures::NOW, $after?->paidAt());
        $this->assertFalse($after?->needsAttention());
        $this->assertCount(1, $f->mailer->to('contact@kcprintworks.com'));
        $this->assertStringContains('has been paid', $f->mailer->sent[0]->body);
        $this->assertTrue(in_array('Paid for custom quote ' . $quote->ref() . '.', $f->orders->orders[$orderId]['notes'], true));
    }

    public function testTheSamePaymentNoticeTwiceChangesNothingTheSecondTime(): void
    {
        [$f, $quote, , $orderId] = $this->approved();
        $f->orders->pay($orderId);
        $f->payments()->onOrderPaid($orderId);
        $f->time += 100;
        $second = $f->payments()->onOrderPaid($orderId);
        $this->assertSame('already_paid', $second->code);
        $this->assertSame(Fixtures::NOW, $f->repo->find($quote->id())?->paidAt(), 'the paid time is not overwritten');
        $this->assertCount(1, $f->mailer->sent, 'one email, not two');
        $paidEvents = array_filter($f->repo->events($quote->id()), static fn ($e): bool => $e->kind === 'paid');
        $this->assertCount(1, $paidEvents);
    }

    public function testAnOrdinaryWooCommerceOrderIsNoneOfOurBusiness(): void
    {
        [$f] = $this->approved();
        $f->orders->orders[5] = ['status' => 'processing', 'currency' => 'USD', 'fee' => 0, 'shipping' => 0, 'tax' => 0, 'other' => 1, 'quoteId' => 0, 'fp' => '', 'closedByPlugin' => false, 'notes' => []];
        $this->assertSame('not_a_quote_order', $f->payments()->onOrderPaid(5)->code);
        $this->assertSame('not_a_quote_order', $f->payments()->onOrderPaid(424242)->code);
        $this->assertSame('ignored', $f->payments()->onOrderCancelled(5)->code);
        $this->assertSame([], $f->mailer->sent);
    }

    public function testAnOrderWhoseAmountWasChangedAfterApprovalIsNotCountedAsPaid(): void
    {
        foreach (['fee' => 100, 'shipping' => 0, 'tax' => 500, 'other' => 1] as $field => $value) {
            [$f, $quote, , $orderId] = $this->approved();
            $f->orders->orders[$orderId][$field] = $value;
            $f->orders->pay($orderId);
            $outcome = $f->payments()->onOrderPaid($orderId);
            $this->assertFalse($outcome->ok, $field);
            $this->assertSame('mismatch', $outcome->code, $field);
            $after = $f->repo->find($quote->id());
            $this->assertSame(Status::APPROVED, $after?->status(), "$field: not Paid");
            $this->assertTrue($after?->needsAttention(), "$field: flagged");
            $this->assertCount(1, $f->mailer->to('contact@kcprintworks.com'), "$field: the owner is told");
            $this->assertStringContains('does not match', $f->orders->orders[$orderId]['notes'][0]);
        }
    }

    public function testMovingMoneyBetweenTheLinesWithoutChangingTheTotalIsStillCaught(): void
    {
        [$f, $quote, , $orderId] = $this->approved();
        $f->orders->orders[$orderId]['fee'] = 4000;
        $f->orders->orders[$orderId]['shipping'] = 1350; // the same $53.50 in total
        $f->orders->pay($orderId);
        $outcome = $f->payments()->onOrderPaid($orderId);
        $this->assertSame('mismatch', $outcome->code);
        $this->assertSame(Status::APPROVED, $f->repo->find($quote->id())?->status());
    }

    public function testAnOrderWithAnotherQuotesFingerprintOrAnotherCurrencyIsNotCountedAsPaid(): void
    {
        [$f, $quote, , $orderId] = $this->approved();
        $f->orders->orders[$orderId]['fp'] = str_repeat('0', 64);
        $f->orders->pay($orderId);
        $this->assertSame('mismatch', $f->payments()->onOrderPaid($orderId)->code);
        $this->assertSame(Status::APPROVED, $f->repo->find($quote->id())?->status());

        [$g, $q2, , $o2] = $this->approved();
        $g->orders->orders[$o2]['currency'] = 'EUR';
        $g->orders->pay($o2);
        $this->assertSame('mismatch', $g->payments()->onOrderPaid($o2)->code);
        $this->assertSame(Status::APPROVED, $g->repo->find($q2->id())?->status());
    }

    public function testATamperedQuoteRowIsAlsoCaught(): void
    {
        [$f, $quote, , $orderId] = $this->approved();
        // Someone edits the quote's price in the database after approval: the order's fingerprint no longer matches the quote.
        $f->repo->swap($quote->id(), [], ['item_cents' => 100], [], $f->time);
        $f->orders->pay($orderId);
        $this->assertSame('mismatch', $f->payments()->onOrderPaid($orderId)->code);
        $this->assertSame(Status::APPROVED, $f->repo->find($quote->id())?->status());
    }

    public function testASecondOrderClaimingTheSameQuoteCannotBePaidIntoIt(): void
    {
        [$f, $quote, , $orderId] = $this->approved();
        $clone = $f->orders->orders[$orderId];
        $f->orders->orders[2000] = $clone;
        $f->orders->orders[2000]['status'] = 'processing';
        $outcome = $f->payments()->onOrderPaid(2000);
        $this->assertSame('wrong_order', $outcome->code);
        $after = $f->repo->find($quote->id());
        $this->assertSame(Status::APPROVED, $after?->status());
        $this->assertSame($orderId, $after?->orderId(), 'the quote still points at its own order');
        $this->assertTrue($after?->needsAttention());
        // The real order can still be paid afterwards.
        $f->orders->pay($orderId);
        $this->assertSame('paid', $f->payments()->onOrderPaid($orderId)->code);
    }

    public function testAPaymentThatArrivesAfterThePaymentWindowStillCounts(): void
    {
        [$f, $quote, , $orderId] = $this->approved();
        $f->time += 72 * 3600 + 500;
        $f->orders->pay($orderId);
        $this->assertSame('paid', $f->payments()->onOrderPaid($orderId)->code, 'approved but the timer had run out');
        $this->assertSame(Status::PAID, $f->repo->find($quote->id())?->status());

        [$g, $q2, , $o2] = $this->approved();
        $g->time += 72 * 3600 + 500;
        $g->payments()->expireOne($g->repo->find($q2->id()));
        // The order was cancelled by the plugin, so a late payment cannot happen normally; if the shop paid it anyway, the money counts.
        $g->orders->pay($o2);
        $this->assertSame('paid', $g->payments()->onOrderPaid($o2)->code, 'expired, then paid anyway');
        $this->assertSame(Status::PAID, $g->repo->find($q2->id())?->status());
    }

    public function testMoneyForACancelledOrDeclinedQuoteIsNeverHiddenItIsPutInFrontOfAPerson(): void
    {
        [$f, $quote, , $orderId] = $this->approved();
        $f->repo->swap($quote->id(), [], ['status' => Status::CANCELLED], [], $f->time);
        $f->orders->pay($orderId);
        $outcome = $f->payments()->onOrderPaid($orderId);
        $this->assertSame('unexpected_state', $outcome->code);
        $after = $f->repo->find($quote->id());
        $this->assertSame(Status::CANCELLED, $after?->status(), 'the status is left for a person to decide');
        $this->assertTrue($after?->needsAttention());
        $this->assertStringContains('Cancelled', $after?->attentionReason() ?? '');
        $this->assertCount(1, $f->mailer->to('contact@kcprintworks.com'));
    }

    public function testCancellingTheUnpaidOrderInWooCommerceCancelsTheQuoteButOurOwnCancellationDoesNot(): void
    {
        [$f, $quote, $token, $orderId] = $this->approved();
        $f->orders->orders[$orderId]['status'] = 'cancelled';
        $this->assertSame('cancelled', $f->payments()->onOrderCancelled($orderId)->code);
        $after = $f->repo->find($quote->id());
        $this->assertSame(Status::CANCELLED, $after?->status());
        $this->assertSame('', $after?->tokenHash());
        $this->assertFalse($f->customer()->view($quote->ref(), $token)['ok']);

        // The plugin cancelled it itself while revising: the notice must not cancel the quote.
        [$g, $q2, , $o2] = $this->approved();
        $g->orders->cancelUnpaid($o2, 'revising');
        $this->assertSame('ignored', $g->payments()->onOrderCancelled($o2)->code);
        $this->assertSame(Status::APPROVED, $g->repo->find($q2->id())?->status());
    }

    public function testCancellingAnAlreadyPaidOrderFlagsTheQuoteForARefundDecision(): void
    {
        [$f, $quote, , $orderId] = $this->approved();
        $f->orders->pay($orderId);
        $f->payments()->onOrderPaid($orderId);
        $f->mailer->sent = [];
        $f->orders->orders[$orderId]['status'] = 'cancelled';
        $f->payments()->onOrderCancelled($orderId);
        $after = $f->repo->find($quote->id());
        $this->assertSame(Status::PAID, $after?->status());
        $this->assertTrue($after?->needsAttention());
        $this->assertCount(1, $f->mailer->to('contact@kcprintworks.com'));
    }

    public function testARefundIsRecordedAndFlaggedWithoutChangingTheStatus(): void
    {
        [$f, $quote, , $orderId] = $this->approved();
        $f->orders->pay($orderId);
        $f->payments()->onOrderPaid($orderId);
        $f->orders->orders[$orderId]['status'] = 'refunded';
        $this->assertSame('noted', $f->payments()->onOrderRefunded($orderId)->code);
        $after = $f->repo->find($quote->id());
        $this->assertSame(Status::PAID, $after?->status());
        $this->assertTrue($after?->needsAttention());
        $kinds = array_map(static fn ($e): string => $e->kind, $f->repo->events($quote->id()));
        $this->assertContains('refunded', $kinds);
    }

    public function testTheHourlyJobEndsOnlyWhatRanOutAndIsSafeToRunTwice(): void
    {
        $f = new Fixtures();
        [$expiring] = $f->sentQuote($f->offer(4500, 850, 2));
        [$fresh] = $f->sentQuote($f->offer(4500, 850, 30));
        [$unpaid, $t3] = $f->sentQuote($f->offer(4500, 850, 30));
        $f->customer()->approve($unpaid->ref(), $t3, Fixtures::json(Fixtures::approval(1)));
        $unpaidOrder = (int) $f->repo->find($unpaid->id())?->orderId();
        [$paying, $t4] = $f->sentQuote($f->offer(4500, 850, 30));
        $f->customer()->approve($paying->ref(), $t4, Fixtures::json(Fixtures::approval(1)));
        $payingOrder = (int) $f->repo->find($paying->id())?->orderId();
        $f->orders->pay($payingOrder); // paid, but the notice has not been processed yet

        $this->assertSame(0, $f->payments()->expireDue(), 'nothing is due yet');
        $f->time += 3 * 86400 + 1; // past the two-day offer and past the three-day payment window
        $this->assertSame(2, $f->payments()->expireDue());
        $this->assertSame(Status::EXPIRED, $f->repo->find($expiring->id())?->status());
        $this->assertSame(Status::QUOTED, $f->repo->find($fresh->id())?->status());
        $this->assertSame(Status::EXPIRED, $f->repo->find($unpaid->id())?->status());
        $this->assertSame('cancelled', $f->orders->orders[$unpaidOrder]['status']);
        $this->assertSame(Status::APPROVED, $f->repo->find($paying->id())?->status(), 'a paid order is never expired from under the customer');
        $this->assertSame(0, $f->payments()->expireDue(), 'a second run finds nothing new');
        $f->payments()->onOrderPaid($payingOrder);
        $this->assertSame(Status::PAID, $f->repo->find($paying->id())?->status());
    }

    public function testAnOrderThatCannotBeCancelledKeepsTheQuoteApprovedAndFlagsIt(): void
    {
        [$f, $quote] = $this->approved();
        $f->time += 72 * 3600 + 1;
        $f->orders->failCancel = true;
        $this->assertSame(0, $f->payments()->expireDue());
        $after = $f->repo->find($quote->id());
        $this->assertSame(Status::APPROVED, $after?->status());
        $this->assertTrue($after?->needsAttention());
    }

    public function testATaxableQuoteAcceptsTheTaxWooCommerceAddedAndNothingMore(): void
    {
        $f = new Fixtures(new Settings(Fixtures::SECRET, 'https://kcprintworks.com', taxable: true));
        [$f, $quote, , $orderId] = $this->approved($f);
        $this->assertTrue($quote->taxable());
        $this->assertSame(535, $f->orders->orders[$orderId]['tax'], 'the fake store added 10% tax');
        $f->orders->pay($orderId);
        $this->assertSame('paid', $f->payments()->onOrderPaid($orderId)->code);

        [$g, $q2, , $o2] = $this->approved(new Fixtures(new Settings(Fixtures::SECRET, 'https://kcprintworks.com', taxable: true)));
        $g->orders->orders[$o2]['fee'] = 1000; // item reduced; the tax would not catch this
        $g->orders->pay($o2);
        $this->assertSame('mismatch', $g->payments()->onOrderPaid($o2)->code);
    }

    public function testAQuoteSentBeforeTaxWasSwitchedOnIsNotTreatedAsTaxableAfterwards(): void
    {
        $f = new Fixtures();
        [$f, $quote, , $orderId] = $this->approved($f);
        $this->assertFalse($quote->taxable());
        $f->orders->orders[$orderId]['tax'] = 100;
        $f->orders->pay($orderId);
        $this->assertSame('mismatch', $f->payments()->onOrderPaid($orderId)->code, 'tax appeared on a quote that was approved as tax-free');
    }

    public function testOfflineMethodsAndPaymentsWithoutATransactionAreNotCountedAsPaid(): void
    {
        foreach ([['cod', 'ch_1'], ['bacs', 'ch_1'], ['cheque', ''], ['', 'ch_1'], ['stripe', ''], ['stripe', '   '], ['mystery_gateway', 'x1']] as [$method, $transaction]) {
            [$f, $quote, , $orderId] = $this->approved();
            $f->orders->pay($orderId, $method, $transaction);
            $outcome = $f->payments()->onOrderPaid($orderId);
            $label = "$method / $transaction";
            $this->assertSame('unconfirmed', $outcome->code, $label);
            $after = $f->repo->find($quote->id());
            $this->assertSame(Status::APPROVED, $after?->status(), "$label: not Paid");
            $this->assertTrue($after?->needsAttention(), "$label: flagged");
            $this->assertCount(1, $f->mailer->to('contact@kcprintworks.com'), "$label: the owner is told");
            $this->assertStringContains('NOT marked paid', $f->orders->orders[$orderId]['notes'][0], $label);
        }
    }

    public function testRealGatewaysAreRecognisedByTheStartOfTheirId(): void
    {
        foreach (['stripe', 'stripe_cc', 'stripe_sepa', 'ppcp-gateway', 'ppcp-credit-card-gateway', 'paypal', 'woocommerce_payments'] as $method) {
            [$f, $quote, , $orderId] = $this->approved();
            $f->orders->pay($orderId, $method, 'txn_123');
            $this->assertSame('paid', $f->payments()->onOrderPaid($orderId)->code, $method);
            $this->assertSame(Status::PAID, $f->repo->find($quote->id())?->status(), $method);
        }
    }

    public function testTheOwnerCanAddAMethodAndRecheck(): void
    {
        $f = new Fixtures(new Settings(Fixtures::SECRET, 'https://kcprintworks.com', paymentMethods: ['stripe', 'bacs']));
        [$f, $quote, , $orderId] = $this->approved($f);
        $f->orders->pay($orderId, 'bacs', 'transfer-ref-9');
        $this->assertSame('paid', $f->payments()->onOrderPaid($orderId)->code, 'a method the owner listed counts');
        $this->assertSame(Status::PAID, $f->repo->find($quote->id())?->status());

        // A flagged quote is moved on by "Re-check payment" once the method is allowed (here: a different shop setting is simulated by a new Settings).
        [$g, $q2, , $o2] = $this->approved();
        $g->orders->pay($o2, 'bacs', 'transfer-ref-9');
        $g->payments()->onOrderPaid($o2);
        $this->assertSame(Status::APPROVED, $g->repo->find($q2->id())?->status());
        $allowed = new Fixtures(new Settings(Fixtures::SECRET, 'https://kcprintworks.com', paymentMethods: ['stripe', 'bacs']));
        $allowed->repo = $g->repo;
        $allowed->orders = $g->orders;
        $outcome = $allowed->admin()->recheckPayment($q2->id(), 'admin:7');
        $this->assertTrue($outcome->ok, $outcome->message);
        $this->assertSame(Status::PAID, $allowed->repo->find($q2->id())?->status());
        $this->assertSame('not_found', $allowed->admin()->recheckPayment(9999, 'a')->code);
        $fresh = $g->newQuote(['email' => 'new@example.com']);
        $this->assertSame('no_order', $g->admin()->recheckPayment($fresh->id(), 'a')->code);
    }

    public function testRecheckingAnUnpaidOrderChangesNothing(): void
    {
        [$f, $quote] = $this->approved();
        $outcome = $f->admin()->recheckPayment($quote->id(), 'admin:7');
        $this->assertFalse($outcome->ok);
        $this->assertSame(Status::APPROVED, $f->repo->find($quote->id())?->status());
    }
}
