<?php
declare(strict_types=1);

namespace KcPrintworks\Quotes\Service;

use KcPrintworks\Quotes\Domain\Quote;
use KcPrintworks\Quotes\Domain\Status;
use KcPrintworks\Quotes\Domain\Text;
use KcPrintworks\Quotes\Domain\Token;
use KcPrintworks\Quotes\Mail\Emails;
use KcPrintworks\Quotes\Support\Money;

/**
 * What the owner (or staff) does in the dashboard. Every method checks the quote's state itself and changes it with a compare-and-swap,
 * so it cannot be tricked by a stale page, a second tab, a customer approving at the same moment, or a repeated click. The caller has
 * already checked who is allowed to do this (the dashboard checks the capability and a nonce first); `$actor` is only for the history.
 */
final class Admin
{
    public function __construct(private readonly Context $c)
    {
    }

    /**
     * Send (or revise, or re-send) the quote to the customer: sets the offer, a new revision and a new secret link, and emails it.
     *
     * @param array{title:string,details:string,itemCents:int,shipCents:int,expiresAt:int} $offer already validated by OfferInput
     */
    public function sendQuote(int $id, array $offer, string $actor): Outcome
    {
        $quote = $this->c->repo->find($id);
        if ($quote === null) {
            return Outcome::fail('not_found', 'That quote no longer exists.');
        }
        $now = $this->c->now();
        if (!in_array($quote->status(), Status::CAN_SEND_QUOTE_FROM, true)) {
            return Outcome::fail('wrong_state', 'A quote that is ' . Status::label($quote->status()) . ' cannot be sent.');
        }
        if ($this->c->settings->storefrontUrl === '') {
            return Outcome::fail('storefront_not_set', 'The storefront address is not set, so the quote link cannot be made. Add KCPW_STOREFRONT_URL to wp-config.php.');
        }
        if ($this->c->settings->secret === '' || strlen($this->c->settings->secret) < 32) {
            return Outcome::fail('secret_not_set', 'KCPW_HANDOFF_SECRET is not set in wp-config.php, so a quote cannot be paid. Set it first.');
        }
        if ($this->c->orders->decimals() !== 2) {
            return Outcome::fail('currency_unsupported', 'Quotes support currencies with two decimal places. Your store is set to ' . $this->c->orders->decimals() . '.');
        }
        $currency = strtoupper($this->c->orders->currency());
        if (preg_match('/^[A-Z]{3}$/D', $currency) !== 1) {
            return Outcome::fail('currency_unsupported', 'The store currency could not be read.');
        }

        if ($quote->status() === Status::APPROVED) {
            if ($quote->orderId() === 0 && $quote->orderLeaseAt() > $now - Customer::LEASE_SECONDS && $quote->orderLease() !== '') {
                return Outcome::fail('busy', 'The customer approved this quote a moment ago and the order is being made. Wait a minute and reload.');
            }
            if ($quote->orderId() > 0) {
                $closed = $this->c->orders->cancelUnpaid($quote->orderId(), 'Cancelled: quote ' . $quote->ref() . ' is being revised.');
                if ($closed === 'paid') {
                    return Outcome::fail('already_paid', 'The customer has already paid for this quote. It cannot be revised.');
                }
                if ($closed === 'failed') {
                    return Outcome::fail('order_cancel_failed', 'The unpaid order #' . $quote->orderId() . ' could not be cancelled, so the quote was not changed. Cancel the order in WooCommerce first.');
                }
            }
        }

        $token = Token::generate();
        $revision = $quote->revision() + 1;
        $swapped = $this->c->repo->swap($id, [$quote->status()], [
            'status' => Status::QUOTED,
            'quote_title' => $offer['title'],
            'quote_details' => $offer['details'],
            'item_cents' => $offer['itemCents'],
            'ship_cents' => $offer['shipCents'],
            'currency' => $currency,
            'taxable' => $this->c->settings->taxable ? 1 : 0,
            'revision' => $revision,
            'quoted_at' => $now,
            'expires_at' => $offer['expiresAt'],
            'token_hash' => Token::hash($token),
            'approved_at' => 0,
            'pay_by' => 0,
            'order_id' => 0,
            'order_fp' => '',
            'order_lease' => '',
            'order_lease_at' => 0,
            'address' => '',
            'phone' => '',
        ], ['revision' => $quote->revision()], $now);
        if (!$swapped) {
            return Outcome::fail('conflict', 'This quote was changed by someone else (or the customer) at the same moment. Reload it and check before sending.');
        }
        $this->c->event($id, $actor, 'quote_sent', 'Quote revision ' . $revision . ': ' . Money::display($offer['itemCents'] + $offer['shipCents'], $currency) . ' total, valid until ' . $this->c->settings->longDate($offer['expiresAt']) . '.');

        $sent = $this->c->repo->find($id);
        if ($sent === null || !$this->c->mailer->send($this->c->emails->quoteSent($sent, $token))) {
            $this->c->flag($id, 'The quote email to the customer could not be sent. Check your site\'s email, then send the quote again.');
            return Outcome::ok('saved_not_emailed', 'The quote is saved but the email could not be sent. Send it again once email works.', ['quote' => $sent]);
        }
        return Outcome::ok('sent', 'The quote was emailed to ' . $quote->email() . '.', ['quote' => $sent]);
    }

    /** The status box. Only the moves in Status::MANUAL are possible; "Approved" and "Paid" are never set by hand. */
    public function changeStatus(int $id, string $to, string $actor): Outcome
    {
        $quote = $this->c->repo->find($id);
        if ($quote === null) {
            return Outcome::fail('not_found', 'That quote no longer exists.');
        }
        $from = $quote->status();
        if (!Status::isKnown($to) || !Status::canChangeByHand($from, $to)) {
            return Outcome::fail('not_allowed', 'A quote that is ' . Status::label($from) . ' cannot be changed to ' . Status::label($to) . ' by hand.');
        }
        if ($from === Status::APPROVED && $quote->orderId() > 0) {
            $closed = $this->c->orders->cancelUnpaid($quote->orderId(), 'Cancelled: quote ' . $quote->ref() . ' was cancelled.');
            if ($closed === 'paid') {
                return Outcome::fail('already_paid', 'The customer has already paid. Refund or cancel the order in WooCommerce first.');
            }
            if ($closed === 'failed') {
                return Outcome::fail('order_cancel_failed', 'The unpaid order #' . $quote->orderId() . ' could not be cancelled, so the quote was not changed.');
            }
        }
        $changes = ['status' => $to];
        // A quote that is taken back, declined, cancelled or reopened has no live link any more.
        if (in_array($from, [Status::QUOTED, Status::APPROVED, Status::EXPIRED], true) || in_array($to, [Status::DECLINED, Status::CANCELLED], true)) {
            $changes['token_hash'] = '';
        }
        if (!$this->c->repo->swap($id, [$from], $changes, [], $this->c->now())) {
            return Outcome::fail('conflict', 'This quote just changed (the customer may have acted). Reload it.');
        }
        $this->c->event($id, $actor, 'status', Status::label($from) . ' to ' . Status::label($to) . '.');
        return Outcome::ok('changed', 'The quote is now ' . Status::label($to) . '.');
    }

    public function addNote(int $id, int $userId, string $author, string $note): Outcome
    {
        if ($this->c->repo->find($id) === null) {
            return Outcome::fail('not_found', 'That quote no longer exists.');
        }
        $text = Text::normalize($note);
        if ($text === null || Text::forbidden($text, true)) {
            return Outcome::fail('invalid_note', 'The note contains characters that cannot be saved.');
        }
        if ($text === '') {
            return Outcome::fail('invalid_note', 'Write something in the note first.');
        }
        if (Text::length($text) > 4000) {
            return Outcome::fail('invalid_note', 'Notes can be at most 4000 characters.');
        }
        $this->c->repo->addNote($id, $userId, Emails::oneLine($author, 100), $text, $this->c->now());
        return Outcome::ok('noted', 'Note added. Only you and your staff can see it.');
    }

    /** A free-form email to the customer (a question, a decline with a reason, an update). It is sent from the shop's own mail and logged. */
    public function emailCustomer(int $id, string $subject, string $message, string $actor): Outcome
    {
        $quote = $this->c->repo->find($id);
        if ($quote === null) {
            return Outcome::fail('not_found', 'That quote no longer exists.');
        }
        if ($quote->erased() || $quote->email() === '') {
            return Outcome::fail('erased', 'This customer\'s details were erased, so there is no one to email.');
        }
        $subject = Emails::oneLine($subject, 150);
        $text = Text::normalize($message);
        if ($subject === '' || mb_strlen($subject, 'UTF-8') < 3) {
            return Outcome::fail('invalid_email', 'Write a subject.');
        }
        if ($text === null || $text === '' || Text::forbidden($text, true)) {
            return Outcome::fail('invalid_email', 'Write a message (plain text).');
        }
        if (Text::length($text) > 4000) {
            return Outcome::fail('invalid_email', 'Messages can be at most 4000 characters.');
        }
        if (!$this->c->mailer->send($this->c->emails->custom($quote, $subject, $text))) {
            return Outcome::fail('mail_failed', 'The email could not be sent. Check your site\'s email settings.');
        }
        $this->c->event($id, $actor, 'email', 'Emailed the customer: ' . $subject);
        return Outcome::ok('emailed', 'Email sent to ' . $quote->email() . '.');
    }

    public function clearAttention(int $id, string $actor): Outcome
    {
        if (!$this->c->repo->swap($id, [], ['attention' => 0, 'attention_reason' => ''], [], $this->c->now())) {
            return Outcome::fail('not_found', 'That quote no longer exists.');
        }
        $this->c->event($id, $actor, 'attention_cleared', 'Marked as looked at.');
        return Outcome::ok('cleared', 'Marked as looked at.');
    }

    /** What the dashboard may offer for this quote right now. @return array{canEditOffer:bool,canSend:bool,statusTargets:list<string>} */
    public static function options(Quote $quote): array
    {
        return [
            'canEditOffer' => in_array($quote->status(), Status::TERMS_EDITABLE, true),
            'canSend' => in_array($quote->status(), Status::CAN_SEND_QUOTE_FROM, true),
            'statusTargets' => Status::manualTargets($quote->status()),
        ];
    }
}
