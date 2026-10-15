<?php
declare(strict_types=1);

namespace KcPrintworks\Quotes\Service;

use KcPrintworks\Quotes\Domain\Fingerprint;
use KcPrintworks\Quotes\Domain\Quote;
use KcPrintworks\Quotes\Domain\Status;
use KcPrintworks\Quotes\Support\Money;

/**
 * Everything that happens to a quote because of what happens to its WooCommerce order, or because time passed. The rule for payment:
 * a quote becomes Paid only when WooCommerce says the order is paid AND the order is still exactly what the customer approved (the
 * fingerprint written on it matches, the amounts match, nothing else was added to it, it is the order this quote points at). Anything
 * else is put in front of a person instead of being quietly counted as paid.
 */
final class Payments
{
    public function __construct(private readonly Context $c)
    {
    }

    /** WooCommerce moved an order to Processing or Completed. Safe to call twice for the same order. */
    public function onOrderPaid(int $orderId): Outcome
    {
        $facts = $this->c->orders->inspect($orderId);
        if ($facts === null || $facts->quoteId < 1) {
            return Outcome::ok('not_a_quote_order');
        }
        $quote = $this->c->repo->find($facts->quoteId);
        if ($quote === null) {
            return Outcome::ok('unknown_quote');
        }
        if ($quote->orderId() !== $orderId) {
            $this->c->event($quote->id(), 'system', 'payment_mismatch', 'Order #' . $orderId . ' says it belongs to this quote, but the quote points at order #' . $quote->orderId() . '. Not counted as paid.');
            $this->c->flag($quote->id(), 'Order #' . $orderId . ' claims to be paid for this quote but is not the quote\'s order. Check it.', true);
            return Outcome::fail('wrong_order', 'The order is not the quote\'s order.');
        }
        if (in_array($quote->status(), [Status::PAID, Status::IN_PRODUCTION, Status::COMPLETED], true)) {
            return Outcome::ok('already_paid');
        }

        $problem = $this->mismatchOf($quote, $facts);
        if ($problem !== null) {
            $this->c->orders->note($orderId, 'Quote ' . $quote->ref() . ': this order does not match the approved quote (' . $problem . '). It was NOT marked paid on the quote.');
            $this->c->event($quote->id(), 'system', 'payment_mismatch', 'Order #' . $orderId . ' is paid but does not match the approved quote: ' . $problem . '.');
            $this->c->flag($quote->id(), 'Order #' . $orderId . ' is paid but does not match the approved quote (' . $problem . '). Check the order before making anything.', true);
            return Outcome::fail('mismatch', $problem);
        }

        $now = $this->c->now();
        // A payment that arrives just after the payment window ended still counts: money received beats a timer.
        if ($this->c->repo->swap($quote->id(), [Status::APPROVED, Status::EXPIRED], ['status' => Status::PAID, 'paid_at' => $now], ['order_id' => $orderId, 'order_fp' => $quote->orderFingerprint()], $now)) {
            $this->c->event($quote->id(), 'system', 'paid', 'Order #' . $orderId . ' was paid: ' . Money::display($quote->totalCents(), $quote->currency()) . '.');
            $this->c->orders->note($orderId, 'Paid for custom quote ' . $quote->ref() . '.');
            $paid = $this->c->repo->find($quote->id());
            if ($paid !== null) {
                $this->c->mailer->send($this->c->emails->paidOwner($paid, $orderId, $this->c->adminUrl($paid->id())));
            }
            return Outcome::ok('paid');
        }
        $latest = $this->c->repo->find($quote->id());
        if ($latest !== null && in_array($latest->status(), [Status::PAID, Status::IN_PRODUCTION, Status::COMPLETED], true)) {
            return Outcome::ok('already_paid');
        }
        $label = Status::label($latest?->status() ?? 'unknown');
        $this->c->event($quote->id(), 'system', 'payment_unexpected', 'Order #' . $orderId . ' was paid while the quote is ' . $label . '.');
        $this->c->flag($quote->id(), 'Order #' . $orderId . ' was paid while this quote is ' . $label . '. Decide whether to make it or refund it.', true);
        return Outcome::fail('unexpected_state', 'Paid while ' . $label);
    }

    /** The order was cancelled (by the owner in WooCommerce, or by the shop's own housekeeping). */
    public function onOrderCancelled(int $orderId): Outcome
    {
        $facts = $this->c->orders->inspect($orderId);
        if ($facts === null || $facts->quoteId < 1 || $facts->closedByPlugin) {
            return Outcome::ok('ignored');
        }
        $quote = $this->c->repo->find($facts->quoteId);
        if ($quote === null || $quote->orderId() !== $orderId) {
            return Outcome::ok('ignored');
        }
        $now = $this->c->now();
        if ($this->c->repo->swap($quote->id(), [Status::APPROVED], ['status' => Status::CANCELLED, 'token_hash' => ''], ['order_id' => $orderId], $now)) {
            $this->c->event($quote->id(), 'system', 'order_cancelled', 'Order #' . $orderId . ' was cancelled in WooCommerce, so the quote was cancelled.');
            return Outcome::ok('cancelled');
        }
        if (in_array($quote->status(), [Status::PAID, Status::IN_PRODUCTION, Status::COMPLETED], true)) {
            $this->c->event($quote->id(), 'system', 'order_cancelled', 'Order #' . $orderId . ' was cancelled after it was paid.');
            $this->c->flag($quote->id(), 'The paid order #' . $orderId . ' was cancelled. Check whether a refund is needed.', true);
        }
        return Outcome::ok('noted');
    }

    /** Money went back to the customer. The quote keeps its status (a person decides what that means for the job). */
    public function onOrderRefunded(int $orderId): Outcome
    {
        $facts = $this->c->orders->inspect($orderId);
        if ($facts === null || $facts->quoteId < 1) {
            return Outcome::ok('ignored');
        }
        $quote = $this->c->repo->find($facts->quoteId);
        if ($quote === null || $quote->orderId() !== $orderId) {
            return Outcome::ok('ignored');
        }
        $this->c->event($quote->id(), 'system', 'refunded', 'Order #' . $orderId . ' was refunded.');
        $this->c->flag($quote->id(), 'Order #' . $orderId . ' was refunded. Update the quote\'s status to match.', false);
        return Outcome::ok('noted');
    }

    /** Ends one quote whose time ran out. A quote whose order turns out to be paid is left alone (the payment notice moves it on). */
    public function expireOne(Quote $quote): bool
    {
        $now = $this->c->now();
        if ($quote->status() === Status::QUOTED && $quote->isExpiredAt($now)) {
            if ($this->c->repo->swap($quote->id(), [Status::QUOTED], ['status' => Status::EXPIRED], ['revision' => $quote->revision()], $now)) {
                $this->c->event($quote->id(), 'system', 'expired', 'The offer ran out on ' . $this->c->settings->longDate($quote->expiresAt()) . '.');
                return true;
            }
            return false;
        }
        if ($quote->status() === Status::APPROVED && $quote->payWindowOver($now)) {
            if ($quote->orderId() === 0 && $quote->orderLeaseAt() > $now - Customer::LEASE_SECONDS && $quote->orderLease() !== '') {
                return false;
            }
            if ($quote->orderId() > 0) {
                $closed = $this->c->orders->cancelUnpaid($quote->orderId(), 'Cancelled: quote ' . $quote->ref() . ' was not paid in time.');
                if ($closed === 'paid') {
                    return false;
                }
                if ($closed === 'failed') {
                    $this->c->flag($quote->id(), 'The unpaid order #' . $quote->orderId() . ' for an expired quote could not be cancelled. Cancel it in WooCommerce.', false);
                    return false;
                }
            }
            if ($this->c->repo->swap($quote->id(), [Status::APPROVED], ['status' => Status::EXPIRED], ['order_id' => $quote->orderId()], $now)) {
                $this->c->event($quote->id(), 'system', 'expired', 'The customer did not pay by ' . $this->c->settings->longDate($quote->payBy()) . '; the unpaid order was cancelled.');
                return true;
            }
        }
        return false;
    }

    /** The hourly job. Returns how many quotes were ended. */
    public function expireDue(int $limit = 50): int
    {
        $ended = 0;
        foreach ($this->c->repo->dueForExpiry($this->c->now(), $limit) as $quote) {
            if ($this->expireOne($quote)) {
                $ended++;
            }
        }
        return $ended;
    }

    /** Why this order is not what the customer approved, or null when it is exactly that. Used before payment is accepted and again when it arrives. */
    public function mismatchOf(Quote $quote, OrderFacts $facts): ?string
    {
        if ($quote->revision() < 1 || $quote->orderFingerprint() === '') {
            return 'the quote has no approved offer';
        }
        $expected = Fingerprint::ofQuote($this->c->settings->secret, $quote);
        if (!hash_equals($expected, $facts->fingerprint) || !hash_equals($expected, $quote->orderFingerprint())) {
            return 'the order\'s fingerprint does not match the approved quote';
        }
        if ($facts->currency !== $quote->currency()) {
            return 'currency ' . $facts->currency . ' instead of ' . $quote->currency();
        }
        if ($facts->otherLines !== 0) {
            return 'it has ' . $facts->otherLines . ' extra line(s) (products, fees or coupons)';
        }
        if ($facts->feeCents !== $quote->itemCents()) {
            return 'item amount ' . Money::display($facts->feeCents, $facts->currency) . ' instead of ' . Money::display($quote->itemCents(), $quote->currency());
        }
        if ($facts->shippingCents !== $quote->shipCents()) {
            return 'shipping ' . Money::display($facts->shippingCents, $facts->currency) . ' instead of ' . Money::display($quote->shipCents(), $quote->currency());
        }
        if (!$quote->taxable() && $facts->taxCents !== 0) {
            return 'it has tax on it, but this quote is not taxable';
        }
        if ($facts->totalCents - $facts->taxCents !== $quote->totalCents()) {
            return 'total ' . Money::display($facts->totalCents, $facts->currency) . ' does not equal the quote';
        }
        return null;
    }
}
