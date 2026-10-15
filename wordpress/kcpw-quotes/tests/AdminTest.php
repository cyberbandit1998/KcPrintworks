<?php
declare(strict_types=1);

namespace KcPrintworks\Quotes\Tests;

use KcPrintworks\Quotes\Domain\OfferInput;
use KcPrintworks\Quotes\Domain\Status;
use KcPrintworks\Quotes\Domain\Token;
use KcPrintworks\Quotes\Service\Settings;

final class AdminTest extends TestCase
{
    public function testSendingAQuoteMakesItQuotedWithARevisionALinkAndAnEmail(): void
    {
        $f = new Fixtures();
        $quote = $f->newQuote();
        $outcome = $f->admin()->sendQuote($quote->id(), $f->offer(4500, 850), 'admin:7');
        $this->assertTrue($outcome->ok, $outcome->message);
        $this->assertSame('sent', $outcome->code);

        $after = $f->repo->find($quote->id());
        $this->assertSame(Status::QUOTED, $after?->status());
        $this->assertSame(1, $after?->revision());
        $this->assertSame(4500, $after?->itemCents());
        $this->assertSame(850, $after?->shipCents());
        $this->assertSame(5350, $after?->totalCents());
        $this->assertSame('USD', $after?->currency());
        $this->assertSame(Fixtures::NOW + 14 * 86400, $after?->expiresAt());

        $mail = $f->mailer->to('robin@example.com');
        $this->assertCount(1, $mail);
        $token = $f->lastToken();
        $this->assertTrue(Token::wellFormed($token));
        $this->assertSame(Token::hash($token), $after?->tokenHash(), 'only the hash is stored');
        $this->assertStringNotContains($token, json_encode($after?->toRow()) ?: '', 'the token itself is not stored');
        $this->assertStringContains('https://kcprintworks.com/custom-orders/quote/?ref=' . $quote->ref() . '&token=' . $token, $mail[0]->body);
        $this->assertStringContains('Item: $45.00', $mail[0]->body);
        $this->assertStringContains('Shipping: $8.50', $mail[0]->body);
        $this->assertStringContains('Total: $53.50', $mail[0]->body);
        $this->assertStringContains('valid until', $mail[0]->body);
        $this->assertStringContains('Printed in PETG', $mail[0]->body);
        $kinds = array_map(static fn ($e): string => $e->kind, $f->repo->events($quote->id()));
        $this->assertContains('quote_sent', $kinds);
    }

    public function testFreeShippingIsSaidInWords(): void
    {
        $f = new Fixtures();
        $quote = $f->newQuote();
        $f->admin()->sendQuote($quote->id(), $f->offer(4500, 0), 'admin:7');
        $this->assertStringContains('Shipping: Free', $f->mailer->to('robin@example.com')[0]->body);
    }

    public function testAQuoteCannotBeSentFromAFinishedOrPaidState(): void
    {
        foreach ([Status::PAID, Status::IN_PRODUCTION, Status::COMPLETED, Status::DECLINED, Status::CANCELLED] as $status) {
            $f = new Fixtures();
            $quote = $f->repo->create(['ref' => 'KCQ-2610-TESTAA', 'status' => $status, 'email' => 'a@example.com', 'name' => 'A B']);
            $outcome = $f->admin()->sendQuote($quote->id(), $f->offer(), 'admin:7');
            $this->assertFalse($outcome->ok, $status);
            $this->assertSame('wrong_state', $outcome->code);
            $this->assertSame($status, $f->repo->find($quote->id())?->status());
            $this->assertSame([], $f->mailer->sent);
        }
    }

    public function testNothingIsChangedWhenTheStorefrontOrSecretOrCurrencyIsNotUsable(): void
    {
        $noStorefront = new Fixtures(new Settings(Fixtures::SECRET, ''));
        $q = $noStorefront->newQuote();
        $o = $noStorefront->admin()->sendQuote($q->id(), $noStorefront->offer(), 'a');
        $this->assertSame('storefront_not_set', $o->code);
        $this->assertSame(Status::NEW, $noStorefront->repo->find($q->id())?->status());

        $noSecret = new Fixtures(new Settings('short', 'https://kcprintworks.com'));
        $q = $noSecret->newQuote();
        $this->assertSame('secret_not_set', $noSecret->admin()->sendQuote($q->id(), $noSecret->offer(), 'a')->code);

        $f = new Fixtures();
        $f->orders->decimals = 0;
        $q = $f->newQuote();
        $this->assertSame('currency_unsupported', $f->admin()->sendQuote($q->id(), $f->offer(), 'a')->code);
        $this->assertSame([], $f->mailer->sent);
    }

    public function testRevisingMakesANewRevisionANewLinkAndKillsTheOldOne(): void
    {
        $f = new Fixtures();
        [$quote, $oldToken] = $f->sentQuote();
        $f->mailer->sent = [];
        $f->time += 3600;
        $outcome = $f->admin()->sendQuote($quote->id(), $f->offer(5000, 900, 10), 'admin:7');
        $this->assertTrue($outcome->ok);
        $now = $f->repo->find($quote->id());
        $this->assertSame(2, $now?->revision());
        $this->assertSame(5900, $now?->totalCents());
        $newToken = $f->lastToken();
        $this->assertTrue($oldToken !== $newToken);
        $this->assertFalse($f->customer()->view($quote->ref(), $oldToken)['ok'], 'the old link is dead');
        $this->assertTrue($f->customer()->view($quote->ref(), $newToken)['ok']);
    }

    public function testRevisingAnApprovedQuoteCancelsItsUnpaidOrderAndStartsOver(): void
    {
        $f = new Fixtures();
        [$quote, $token] = $f->sentQuote();
        $approved = $f->customer()->approve($quote->ref(), $token, Fixtures::json(Fixtures::approval(1)));
        $this->assertTrue($approved['ok']);
        $orderId = $f->repo->find($quote->id())?->orderId();
        $this->assertTrue($orderId > 0);

        $outcome = $f->admin()->sendQuote($quote->id(), $f->offer(6000, 0), 'admin:7');
        $this->assertTrue($outcome->ok, $outcome->message);
        $this->assertSame('cancelled', $f->orders->orders[$orderId]['status']);
        $after = $f->repo->find($quote->id());
        $this->assertSame(Status::QUOTED, $after?->status());
        $this->assertSame(0, $after?->orderId());
        $this->assertSame(2, $after?->revision());
        $this->assertSame('', $after?->addressJson());
        $this->assertFalse($f->customer()->view($quote->ref(), $token)['ok'], 'the approved link is dead after a revision');
    }

    public function testAPaidQuoteCannotBeRevisedAndIfTheOrderCannotBeCancelledNothingChanges(): void
    {
        $f = new Fixtures();
        [$quote, $token] = $f->sentQuote();
        $f->customer()->approve($quote->ref(), $token, Fixtures::json(Fixtures::approval(1)));
        $orderId = (int) $f->repo->find($quote->id())?->orderId();

        $f->orders->failCancel = true;
        $stuck = $f->admin()->sendQuote($quote->id(), $f->offer(6000, 0), 'admin:7');
        $this->assertSame('order_cancel_failed', $stuck->code);
        $this->assertSame(Status::APPROVED, $f->repo->find($quote->id())?->status());
        $this->assertSame(1, $f->repo->find($quote->id())?->revision());

        $f->orders->failCancel = false;
        $f->orders->pay($orderId);
        $paid = $f->admin()->sendQuote($quote->id(), $f->offer(6000, 0), 'admin:7');
        $this->assertSame('already_paid', $paid->code);
        $this->assertSame(Status::APPROVED, $f->repo->find($quote->id())?->status());
    }

    public function testManualStatusChangesFollowTheTableAndNeverReachApprovedOrPaid(): void
    {
        $allowed = [
            [Status::NEW, Status::REVIEWING], [Status::NEW, Status::DECLINED], [Status::NEW, Status::CANCELLED],
            [Status::REVIEWING, Status::NEW], [Status::REVIEWING, Status::DECLINED], [Status::REVIEWING, Status::CANCELLED],
            [Status::QUOTED, Status::REVIEWING], [Status::QUOTED, Status::DECLINED], [Status::QUOTED, Status::CANCELLED],
            [Status::APPROVED, Status::CANCELLED], [Status::PAID, Status::IN_PRODUCTION], [Status::IN_PRODUCTION, Status::COMPLETED],
            [Status::DECLINED, Status::REVIEWING], [Status::EXPIRED, Status::REVIEWING],
        ];
        foreach (Status::all() as $from) {
            foreach (Status::all() as $to) {
                $f = new Fixtures();
                $quote = $f->repo->create(['ref' => 'KCQ-2610-TESTBB', 'status' => $from, 'email' => 'a@example.com', 'name' => 'A B']);
                $outcome = $f->admin()->changeStatus($quote->id(), $to, 'admin:7');
                $should = in_array([$from, $to], $allowed, true);
                $this->assertSame($should, $outcome->ok, "$from -> $to");
                $this->assertSame($should ? $to : $from, $f->repo->find($quote->id())?->status(), "$from -> $to result");
            }
        }
        $f = new Fixtures();
        $quote = $f->newQuote();
        $this->assertSame('not_allowed', $f->admin()->changeStatus($quote->id(), 'banana', 'a')->code);
        $this->assertSame('not_found', $f->admin()->changeStatus(9999, Status::REVIEWING, 'a')->code);
    }

    public function testTakingBackDecliningOrCancellingAQuoteKillsItsLink(): void
    {
        foreach ([Status::REVIEWING, Status::CANCELLED, Status::DECLINED] as $to) {
            $f = new Fixtures();
            [$quote, $token] = $f->sentQuote();
            $this->assertTrue($f->customer()->view($quote->ref(), $token)['ok']);
            $outcome = $f->admin()->changeStatus($quote->id(), $to, 'admin:7');
            $this->assertTrue($outcome->ok, $to);
            $this->assertFalse($f->customer()->view($quote->ref(), $token)['ok'], "link after $to");
            $this->assertSame('', $f->repo->find($quote->id())?->tokenHash());
        }
    }

    public function testCancellingAnApprovedQuoteCancelsTheUnpaidOrderButNeverAPaidOne(): void
    {
        $f = new Fixtures();
        [$quote, $token] = $f->sentQuote();
        $f->customer()->approve($quote->ref(), $token, Fixtures::json(Fixtures::approval(1)));
        $orderId = (int) $f->repo->find($quote->id())?->orderId();
        $this->assertTrue($f->admin()->changeStatus($quote->id(), Status::CANCELLED, 'admin:7')->ok);
        $this->assertSame('cancelled', $f->orders->orders[$orderId]['status']);

        $g = new Fixtures();
        [$q2, $t2] = $g->sentQuote();
        $g->customer()->approve($q2->ref(), $t2, Fixtures::json(Fixtures::approval(1)));
        $o2 = (int) $g->repo->find($q2->id())?->orderId();
        $g->orders->pay($o2);
        $refused = $g->admin()->changeStatus($q2->id(), Status::CANCELLED, 'admin:7');
        $this->assertSame('already_paid', $refused->code);
        $this->assertSame(Status::APPROVED, $g->repo->find($q2->id())?->status());
    }

    public function testNotesAreValidatedAndKeptPrivate(): void
    {
        $f = new Fixtures();
        $quote = $f->newQuote();
        $this->assertTrue($f->admin()->addNote($quote->id(), 7, "Kim\r\nBcc: x", 'Called him: wants it by June')->ok);
        $notes = $f->repo->notes($quote->id());
        $this->assertCount(1, $notes);
        $this->assertSame('Kim Bcc: x', $notes[0]->author, 'the author name is one line');
        $this->assertFalse($f->admin()->addNote($quote->id(), 7, 'Kim', '   ')->ok);
        $this->assertFalse($f->admin()->addNote($quote->id(), 7, 'Kim', "bad\x00char")->ok);
        $this->assertFalse($f->admin()->addNote($quote->id(), 7, 'Kim', str_repeat('a', 4001))->ok);
        $this->assertFalse($f->admin()->addNote(9999, 7, 'Kim', 'hello')->ok);
        // Notes appear in no email.
        $f->admin()->sendQuote($quote->id(), $f->offer(), 'admin:7');
        foreach ($f->mailer->sent as $message) {
            $this->assertStringNotContains('wants it by June', $message->body);
        }
    }

    public function testEmailingTheCustomerIsValidatedLoggedAndSingleLine(): void
    {
        $f = new Fixtures();
        $quote = $f->newQuote();
        $this->assertTrue($f->admin()->emailCustomer($quote->id(), "Question about\r\nyour case", 'What lid color do you want?', 'admin:7')->ok);
        $message = $f->mailer->to('robin@example.com')[0];
        $this->assertSame('Question about your case', $message->subject);
        $this->assertStringContains('What lid color do you want?', $message->body);
        $this->assertStringContains($quote->ref(), $message->body);
        $this->assertFalse($f->admin()->emailCustomer($quote->id(), 'x', 'hello', 'a')->ok, 'subject too short');
        $this->assertFalse($f->admin()->emailCustomer($quote->id(), 'Hello there', '', 'a')->ok, 'empty message');
        $f->mailer->fail = true;
        $this->assertSame('mail_failed', $f->admin()->emailCustomer($quote->id(), 'Hello there', 'Hi', 'a')->code);
        $kinds = array_map(static fn ($e): string => $e->kind, $f->repo->events($quote->id()));
        $this->assertSame(1, count(array_filter($kinds, static fn ($k): bool => $k === 'email')), 'only the email that was sent is in the history');
    }

    public function testAQuoteEmailThatFailsKeepsTheQuoteAndFlagsItSoItCanBeSentAgain(): void
    {
        $f = new Fixtures();
        $quote = $f->newQuote();
        $f->mailer->fail = true;
        $outcome = $f->admin()->sendQuote($quote->id(), $f->offer(), 'admin:7');
        $this->assertTrue($outcome->ok);
        $this->assertSame('saved_not_emailed', $outcome->code);
        $after = $f->repo->find($quote->id());
        $this->assertSame(Status::QUOTED, $after?->status());
        $this->assertTrue($after?->needsAttention());
        $f->mailer->fail = false;
        $this->assertTrue($f->admin()->sendQuote($quote->id(), $f->offer(), 'admin:7')->ok, 'sending again works and makes a fresh link');
        $this->assertSame(2, $f->repo->find($quote->id())?->revision());
        $this->assertTrue($f->admin()->clearAttention($quote->id(), 'admin:7')->ok);
        $this->assertFalse($f->repo->find($quote->id())?->needsAttention());
    }

    public function testTheOfferFormTurnsTextIntoCentsAndRefusesNonsense(): void
    {
        $zone = new \DateTimeZone('America/Detroit');
        $now = Fixtures::NOW;
        $good = OfferInput::validate(['title' => ' Custom case ', 'details' => "Line\r\n\r\n\r\nTwo", 'item_price' => '$1,250.50', 'shipping_price' => '8.5', 'expires' => ''], $now, $zone, 14);
        $this->assertTrue($good->ok);
        $this->assertSame(125050, $good->value['itemCents']);
        $this->assertSame(850, $good->value['shipCents']);
        $this->assertSame('Custom case', $good->value['title']);
        $this->assertSame("Line\n\nTwo", $good->value['details']);
        $this->assertTrue($good->value['expiresAt'] > $now + 13 * 86400 && $good->value['expiresAt'] < $now + 15 * 86400);

        $free = OfferInput::validate(['title' => 'Custom case', 'item_price' => '45', 'shipping_price' => '', 'expires' => ''], $now, $zone, 14);
        $this->assertSame(0, $free->value['shipCents']);

        foreach ([
            ['item_price' => '', 'field' => 'item_price'],
            ['item_price' => '0', 'field' => 'item_price'],
            ['item_price' => '-5', 'field' => 'item_price'],
            ['item_price' => '12.345', 'field' => 'item_price'],
            ['item_price' => '1e3', 'field' => 'item_price'],
            ['item_price' => 'free', 'field' => 'item_price'],
            ['item_price' => '0.10', 'field' => 'item_price'],
            ['item_price' => '60000', 'field' => 'item_price'],
            ['shipping_price' => 'abc', 'field' => 'shipping_price'],
            ['title' => '', 'field' => 'title'],
            ['title' => 'ab', 'field' => 'title'],
            ['title' => str_repeat('a', 121), 'field' => 'title'],
            ['title' => "bad\x00title", 'field' => 'title'],
            ['details' => str_repeat('a', 4001), 'field' => 'details'],
            ['expires' => '2020-01-01', 'field' => 'expires'],
            ['expires' => '2026-02-30', 'field' => 'expires'],
            ['expires' => date('Y-m-d', $now + 400 * 86400), 'field' => 'expires'],
        ] as $case) {
            $field = $case['field'];
            unset($case['field']);
            $result = OfferInput::validate($case + ['title' => 'Custom case', 'item_price' => '45.00', 'shipping_price' => '', 'expires' => ''], $now, $zone, 14);
            $this->assertFalse($result->ok, json_encode($case) ?: '');
            $this->assertSame($field, $result->issues[0]['field'], json_encode($case) ?: '');
        }
        $today = (new \DateTimeImmutable('@' . $now))->setTimezone($zone)->format('Y-m-d');
        $endToday = OfferInput::validate(['title' => 'Custom case', 'item_price' => '45', 'expires' => $today], $now, $zone, 14);
        $this->assertTrue($endToday->ok, 'an offer may stand until the end of today');
        $this->assertSame('23:59:59', (new \DateTimeImmutable('@' . $endToday->value['expiresAt']))->setTimezone($zone)->format('H:i:s'));
    }
}
