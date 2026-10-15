<?php
declare(strict_types=1);

namespace KcPrintworks\Quotes\Tests;

use KcPrintworks\Quotes\Domain\Fingerprint;
use KcPrintworks\Quotes\Domain\Status;
use KcPrintworks\Quotes\Service\Customer;

final class CustomerTest extends TestCase
{
    public function testTheRightLinkShowsTheOfferAndOnlyTheOffer(): void
    {
        $f = new Fixtures();
        [$quote, $token] = $f->sentQuote();
        $view = $f->customer()->view($quote->ref(), $token);
        $this->assertTrue($view['ok']);
        $this->assertSame('open', $view['state']);
        $this->assertSame(5350, $view['totalCents']);
        $this->assertSame(4500, $view['itemCents']);
        $this->assertSame(850, $view['shipCents']);
        $this->assertSame('Robin', $view['firstName']);
        $this->assertSame(1, $view['revision']);
        $this->assertSame('Game case or box', $view['project']);
        // Nothing private about the customer or the shop's own handling goes back through a link.
        $text = json_encode($view) ?: '';
        foreach (['robin@example.com', 'sleeves', 'Forest green', '48503', 'token', 'hash', 'attention', 'order'] as $private) {
            $this->assertStringNotContains($private, $text);
        }
    }

    public function testAWrongTokenAWrongReferenceAndJunkAllGetTheSameAnswer(): void
    {
        $f = new Fixtures();
        [$quote, $token] = $f->sentQuote();
        $other = $f->newQuote(['email' => 'other@example.com', 'description' => 'A completely different request for a different case.']);
        $f->admin()->sendQuote($other->id(), $f->offer(), 'a');
        $otherToken = $f->lastToken();

        $answers = [
            $f->customer()->view($quote->ref(), str_repeat('A', 43)),
            $f->customer()->view($quote->ref(), $otherToken),
            $f->customer()->view('KCQ-2610-ZZZZZZ', $token),
            $f->customer()->view('not a reference', $token),
            $f->customer()->view($quote->ref(), ''),
            $f->customer()->view($quote->ref(), $token . 'x'),
            $f->customer()->view($quote->ref(), substr($token, 0, 42)),
        ];
        foreach ($answers as $i => $answer) {
            $this->assertSame(['ok' => false, 'status' => 'invalid_link'], $answer, "case $i");
        }
        $this->assertTrue($f->customer()->view($quote->ref(), $token)['ok']);
        // A quote that was never sent has no link at all.
        $this->assertSame('invalid_link', $f->customer()->view($f->newQuote(['email' => 'new@example.com', 'description' => 'Yet another distinct request for a case.'])->ref(), $token)['status']);
    }

    public function testApprovingMakesOneOrderWithTheQuotedAmountsAndHandsBackThePaymentAddress(): void
    {
        $f = new Fixtures();
        [$quote, $token] = $f->sentQuote();
        $f->mailer->sent = [];
        $result = $f->customer()->approve($quote->ref(), $token, Fixtures::json(Fixtures::approval(1)));
        $this->assertTrue($result['ok'], json_encode($result) ?: '');
        $this->assertSame('approved', $result['status']);
        $this->assertStringContains('/checkout/order-pay/', $result['payUrl']);

        $after = $f->repo->find($quote->id());
        $this->assertSame(Status::APPROVED, $after?->status());
        $this->assertSame(Fixtures::NOW + 72 * 3600, $after?->payBy());
        $this->assertTrue($after?->orderId() > 0);
        $this->assertSame(1, $f->orders->created);
        $order = $f->orders->orders[$after->orderId()];
        $this->assertSame(4500, $order['fee'], 'item amount comes from the quote');
        $this->assertSame(850, $order['shipping'], 'shipping comes from the quote');
        $this->assertSame($quote->id(), $order['quoteId']);
        $this->assertSame(Fingerprint::ofQuote(Fixtures::SECRET, $after), $order['fp']);
        $this->assertSame($order['fp'], $after->orderFingerprint());
        $this->assertSame('12 Main Street', $order['address']['line1']);
        $this->assertSame('US', $order['address']['country']);
        $this->assertSame('+1 810 555 0100', $order['address']['phone']);
        $this->assertSame('', $after->orderLease(), 'the lease is released');

        $owner = $f->mailer->to('contact@kcprintworks.com');
        $this->assertCount(1, $owner);
        $this->assertStringContains('was approved', $owner[0]->body);
        $this->assertStringContains('order #' . $after->orderId(), $owner[0]->body);
        $kinds = array_map(static fn ($e): string => $e->kind, $f->repo->events($quote->id()));
        $this->assertContains('approved', $kinds);
        $this->assertContains('order_created', $kinds);
    }

    public function testAnApprovalCannotCarryAPriceOrAnythingElseTheCustomerShouldNotSet(): void
    {
        $f = new Fixtures();
        [$quote, $token] = $f->sentQuote();
        foreach (['price' => 1, 'total' => 1, 'itemCents' => 1, 'shipCents' => 0, 'amount' => 1, 'status' => 'paid', 'orderId' => 5, 'ref' => 'KCQ-2610-OTHERR', 'discount' => 50, 'taxable' => false, 'fee' => 1] as $field => $value) {
            $result = $f->customer()->approve($quote->ref(), $token, Fixtures::json(Fixtures::approval(1, [$field => $value])));
            $this->assertFalse($result['ok'], $field);
            $this->assertSame('invalid_request', $result['status'], $field);
            $this->assertSame($field, $result['problems'][0]['field']);
        }
        $this->assertSame(Status::QUOTED, $f->repo->find($quote->id())?->status());
        $this->assertSame(0, $f->orders->created, 'no order was made for any of them');
        $this->assertSame(5350, $f->repo->find($quote->id())?->totalCents(), 'and the price is unchanged');
    }

    public function testAnApprovalWithoutTheTickOrWithAnIncompleteAddressDoesNothing(): void
    {
        $f = new Fixtures();
        [$quote, $token] = $f->sentQuote();
        foreach ([['accepted' => false], ['accepted' => 'yes'], ['line1' => ''], ['city' => ''], ['postcode' => '!!'], ['country' => 'USA'], ['revision' => '1']] as $bad) {
            $result = $f->customer()->approve($quote->ref(), $token, Fixtures::json(Fixtures::approval(1, $bad)));
            $this->assertSame('invalid_request', $result['status'], json_encode($bad) ?: '');
        }
        foreach ([null, 'text', [], 5] as $junk) {
            $this->assertSame('invalid_request', $f->customer()->approve($quote->ref(), $token, $junk)['status']);
        }
        $this->assertSame(Status::QUOTED, $f->repo->find($quote->id())?->status());
        $this->assertSame(0, $f->orders->created);
    }

    public function testClickingApproveTwiceMakesOneOrderAndGivesTheSameAddress(): void
    {
        $f = new Fixtures();
        [$quote, $token] = $f->sentQuote();
        $first = $f->customer()->approve($quote->ref(), $token, Fixtures::json(Fixtures::approval(1)));
        $second = $f->customer()->approve($quote->ref(), $token, Fixtures::json(Fixtures::approval(1, ['line1' => '99 Other Road'])));
        $this->assertTrue($first['ok']);
        $this->assertTrue($second['ok']);
        $this->assertSame('already_approved', $second['status']);
        $this->assertSame($first['payUrl'], $second['payUrl']);
        $this->assertSame(1, $f->orders->created);
        $this->assertSame('12 Main Street', $f->orders->orders[$f->repo->find($quote->id())?->orderId()]['address']['line1'], 'the first address stands');
        $this->assertCount(1, $f->mailer->to('contact@kcprintworks.com'), 'one email to the owner');
    }

    public function testTwoApprovalsRacingForTheSameQuoteOnlyOneCreatesAnOrder(): void
    {
        $f = new Fixtures();
        [$quote, $token] = $f->sentQuote();
        // Request B arrives while request A holds the lease and has not made the order yet.
        $f->repo->swap($quote->id(), [Status::QUOTED], ['status' => Status::APPROVED, 'approved_at' => $f->time, 'pay_by' => $f->time + 1000, 'address' => '{"line1":"12 Main Street","line2":"","city":"Flint","state":"","postcode":"48503","country":"US"}', 'order_lease' => 'request-a', 'order_lease_at' => $f->time], [], $f->time);
        $b = $f->customer()->approve($quote->ref(), $token, Fixtures::json(Fixtures::approval(1)));
        $this->assertFalse($b['ok']);
        $this->assertSame('busy', $b['status']);
        $this->assertSame(0, $f->orders->created);

        // The request that held the lease crashed: after the lease runs out another request takes over and makes the one order.
        $f->time += Customer::LEASE_SECONDS + 1;
        $c = $f->customer()->approve($quote->ref(), $token, Fixtures::json(Fixtures::approval(1)));
        $this->assertTrue($c['ok'], json_encode($c) ?: '');
        $this->assertSame(1, $f->orders->created);
    }

    public function testAnOrderThatAlreadyExistsForTheQuoteIsReusedNotDuplicated(): void
    {
        $f = new Fixtures();
        [$quote, $token] = $f->sentQuote();
        $f->customer()->approve($quote->ref(), $token, Fixtures::json(Fixtures::approval(1)));
        $orderId = (int) $f->repo->find($quote->id())?->orderId();
        // The process died after WooCommerce made the order but before the quote was told: the quote has no order id.
        $f->repo->swap($quote->id(), [], ['order_id' => 0, 'order_fp' => '', 'order_lease' => 'dead', 'order_lease_at' => $f->time - 1000], [], $f->time);
        $again = $f->customer()->approve($quote->ref(), $token, Fixtures::json(Fixtures::approval(1)));
        $this->assertTrue($again['ok']);
        $this->assertSame(1, $f->orders->created, 'still one order');
        $this->assertSame($orderId, $f->repo->find($quote->id())?->orderId());
    }

    public function testApprovingARevisedOrOldOffersIsRefused(): void
    {
        $f = new Fixtures();
        [$quote, $oldToken] = $f->sentQuote();
        $f->admin()->sendQuote($quote->id(), $f->offer(9900, 0), 'admin:7');
        $newToken = $f->lastToken();

        $oldLink = $f->customer()->approve($quote->ref(), $oldToken, Fixtures::json(Fixtures::approval(1)));
        $this->assertSame('invalid_link', $oldLink['status'], 'the old link no longer works at all');
        $staleForm = $f->customer()->approve($quote->ref(), $newToken, Fixtures::json(Fixtures::approval(1)));
        $this->assertSame('terms_changed', $staleForm['status'], 'a page showing revision 1 cannot approve revision 2');
        $this->assertSame(Status::QUOTED, $f->repo->find($quote->id())?->status());
        $this->assertSame(0, $f->orders->created);
        $good = $f->customer()->approve($quote->ref(), $newToken, Fixtures::json(Fixtures::approval(2)));
        $this->assertTrue($good['ok']);
        $this->assertSame(9900, $f->orders->orders[$f->repo->find($quote->id())?->orderId()]['fee']);
    }

    public function testAnExpiredOfferCannotBeApprovedAndIsMarkedExpired(): void
    {
        $f = new Fixtures();
        [$quote, $token] = $f->sentQuote($f->offer(4500, 850, 3));
        $f->time += 3 * 86400;
        $view = $f->customer()->view($quote->ref(), $token);
        $this->assertSame('expired', $view['state']);
        $this->assertSame(Status::EXPIRED, $f->repo->find($quote->id())?->status());
        $result = $f->customer()->approve($quote->ref(), $token, Fixtures::json(Fixtures::approval(1)));
        $this->assertSame(['ok' => false, 'status' => 'expired'], $result);
        $this->assertSame(0, $f->orders->created);

        $g = new Fixtures();
        [$q2, $t2] = $g->sentQuote($g->offer(4500, 850, 3));
        $g->time += 3 * 86400;
        $this->assertSame('expired', $g->customer()->approve($q2->ref(), $t2, Fixtures::json(Fixtures::approval(1)))['status'], 'approving after the time is up, without looking first');
        $this->assertSame(Status::EXPIRED, $g->repo->find($q2->id())?->status());
    }

    public function testTheOfferStandsUntilTheLastSecondOfItsDay(): void
    {
        $f = new Fixtures();
        [$quote, $token] = $f->sentQuote($f->offer(4500, 850, 3));
        $f->time = $f->repo->find($quote->id())?->expiresAt() - 1;
        $this->assertTrue($f->customer()->approve($quote->ref(), $token, Fixtures::json(Fixtures::approval(1)))['ok'], 'one second before');
    }

    public function testWhenWooCommerceCannotMakeTheOrderNothingIsLeftHalfDone(): void
    {
        $f = new Fixtures();
        [$quote, $token] = $f->sentQuote();
        $f->orders->failCreate = true;
        $f->mailer->sent = [];
        $result = $f->customer()->approve($quote->ref(), $token, Fixtures::json(Fixtures::approval(1)));
        $this->assertSame(['ok' => false, 'status' => 'unavailable'], $result);
        $after = $f->repo->find($quote->id());
        $this->assertSame(Status::QUOTED, $after?->status(), 'back to Quoted, so the same link works again');
        $this->assertSame(0, $after?->orderId());
        $this->assertSame('', $after?->orderLease());
        $this->assertSame('', $after?->addressJson());
        $this->assertTrue($after?->needsAttention());
        $this->assertCount(1, $f->mailer->to('contact@kcprintworks.com'), 'the owner is told');
        $this->assertStringNotContains('WooCommerce said no', json_encode($result) ?: '', 'the customer is not shown internals');

        $f->orders->failCreate = false;
        $retry = $f->customer()->approve($quote->ref(), $token, Fixtures::json(Fixtures::approval(1)));
        $this->assertTrue($retry['ok']);
        $this->assertSame(1, $f->orders->created);
    }

    public function testTheLinkOfAnApprovedQuoteShowsThePaymentAddressUntilThePaymentWindowEnds(): void
    {
        $f = new Fixtures();
        [$quote, $token] = $f->sentQuote();
        $approved = $f->customer()->approve($quote->ref(), $token, Fixtures::json(Fixtures::approval(1)));
        $view = $f->customer()->view($quote->ref(), $token);
        $this->assertSame('approved', $view['state']);
        $this->assertSame($approved['payUrl'], $view['payUrl']);

        $f->time += 72 * 3600 + 1;
        $late = $f->customer()->view($quote->ref(), $token);
        $this->assertSame('expired', $late['state']);
        $this->assertTrue(!isset($late['payUrl']));
        $this->assertSame(Status::EXPIRED, $f->repo->find($quote->id())?->status());
        $this->assertSame('cancelled', $f->orders->orders[$f->repo->find($quote->id())?->orderId()]['status'], 'the unpaid order is cancelled');
    }

    public function testAfterPaymentTheLinkSaysPaidAndNeverOffersToPayOrApproveAgain(): void
    {
        $f = new Fixtures();
        [$quote, $token] = $f->sentQuote();
        $f->customer()->approve($quote->ref(), $token, Fixtures::json(Fixtures::approval(1)));
        $orderId = (int) $f->repo->find($quote->id())?->orderId();
        $f->orders->pay($orderId);
        $f->payments()->onOrderPaid($orderId);
        $view = $f->customer()->view($quote->ref(), $token);
        $this->assertSame('paid', $view['state']);
        $this->assertTrue(!isset($view['payUrl']));
        $again = $f->customer()->approve($quote->ref(), $token, Fixtures::json(Fixtures::approval(1)));
        $this->assertSame('already_paid', $again['status']);
        $this->assertSame(1, $f->orders->created);
    }

    public function testACancelledOrDeclinedQuoteOffersNothing(): void
    {
        $f = new Fixtures();
        [$quote, $token] = $f->sentQuote();
        $f->admin()->changeStatus($quote->id(), Status::CANCELLED, 'admin:7');
        $this->assertSame('invalid_link', $f->customer()->approve($quote->ref(), $token, Fixtures::json(Fixtures::approval(1)))['status']);
        $this->assertSame(0, $f->orders->created);
    }

    public function testAQuoteInAnotherCurrencyThanTheStoreCannotBeApproved(): void
    {
        $f = new Fixtures();
        [$quote, $token] = $f->sentQuote();
        $f->orders->currency = 'EUR';
        $result = $f->customer()->approve($quote->ref(), $token, Fixtures::json(Fixtures::approval(1)));
        $this->assertSame('unavailable', $result['status']);
        $this->assertSame(Status::QUOTED, $f->repo->find($quote->id())?->status());
        $this->assertSame(0, $f->orders->created);
    }

    public function testAnOrderFromAnEarlierRevisionIsCancelledAndReplacedNotReused(): void
    {
        $f = new Fixtures();
        [$quote, $token] = $f->sentQuote();
        $f->customer()->approve($quote->ref(), $token, Fixtures::json(Fixtures::approval(1)));
        $oldOrder = (int) $f->repo->find($quote->id())?->orderId();
        // A request died while the owner revised: the old order is still pending and the quote has moved to revision 2 with no order.
        $f->repo->swap($quote->id(), [], ['status' => Status::QUOTED, 'revision' => 2, 'item_cents' => 9900, 'token_hash' => \KcPrintworks\Quotes\Domain\Token::hash($token), 'order_id' => 0, 'order_fp' => '', 'approved_at' => 0, 'pay_by' => 0, 'address' => ''], [], $f->time);
        $result = $f->customer()->approve($quote->ref(), $token, Fixtures::json(Fixtures::approval(2)));
        $this->assertTrue($result['ok'], json_encode($result) ?: '');
        $newOrder = (int) $f->repo->find($quote->id())?->orderId();
        $this->assertTrue($newOrder !== $oldOrder);
        $this->assertSame('cancelled', $f->orders->orders[$oldOrder]['status']);
        $this->assertSame(9900, $f->orders->orders[$newOrder]['fee']);
        $this->assertSame(2, $f->orders->created);
    }

    public function testIfTheOwnerCancelsWhileTheOrderIsBeingMadeTheOrderIsDiscardedAndTheCustomerIsToldTruthfully(): void
    {
        $f = new Fixtures();
        [$quote, $token] = $f->sentQuote();
        $f->orders->beforeCreate = function () use ($f, $quote): void {
            // The worst moment: the owner's cancel lands after the lease was taken and before the order is saved on the quote.
            $f->repo->swap($quote->id(), [], ['status' => Status::CANCELLED, 'token_hash' => ''], [], $f->time);
        };
        $result = $f->customer()->approve($quote->ref(), $token, Fixtures::json(Fixtures::approval(1)));
        $this->assertSame(['ok' => false, 'status' => 'not_open'], $result, 'no payment address for a dead quote');
        $this->assertCount(1, $f->orders->orders);
        $this->assertSame('cancelled', array_values($f->orders->orders)[0]['status'], 'the stray order is cancelled, not left pending');
        $kinds = array_map(static fn ($e): string => $e->kind, $f->repo->events($quote->id()));
        $this->assertContains('order_discarded', $kinds);
    }

    public function testAnOrderThatWasPaidBeforeTheQuoteKnewItIsRecognisedNotDuplicated(): void
    {
        $f = new Fixtures();
        [$quote, $token] = $f->sentQuote();
        $f->customer()->approve($quote->ref(), $token, Fixtures::json(Fixtures::approval(1)));
        $orderId = (int) $f->repo->find($quote->id())?->orderId();
        $f->repo->swap($quote->id(), [], ['order_id' => 0, 'order_fp' => ''], [], $f->time);
        $f->orders->pay($orderId);
        $result = $f->customer()->approve($quote->ref(), $token, Fixtures::json(Fixtures::approval(1)));
        $this->assertSame('already_paid', $result['status']);
        $this->assertSame(1, $f->orders->created, 'no second order');
        $this->assertSame(Status::PAID, $f->repo->find($quote->id())?->status());
    }
}
