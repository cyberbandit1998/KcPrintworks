<?php
declare(strict_types=1);

namespace KcPrintworks\Quotes\Service;

use KcPrintworks\Quotes\Domain\ApprovalInput;
use KcPrintworks\Quotes\Domain\Fingerprint;
use KcPrintworks\Quotes\Domain\Quote;
use KcPrintworks\Quotes\Domain\QuoteInput;
use KcPrintworks\Quotes\Domain\Status;
use KcPrintworks\Quotes\Domain\Token;
use KcPrintworks\Quotes\Support\Json;

/**
 * What a customer does with their private link: look at the offer, and approve it. The link is the only credential, so everything that
 * follows from it is narrow:
 *
 *   - The quote is found by its reference and the token is compared in constant time against the stored hash. A wrong reference and a
 *     wrong token get the same answer ("invalid_link"), so nobody can find out which references exist.
 *   - Approving works once: the Quoted -> Approved change is a compare-and-swap on the revision the customer saw. A second click, a second
 *     tab, an old link, a revised quote or an expired one all fail in that one place.
 *   - The amounts come from the quote in the database, never from the request. The request carries the revision and the address.
 *   - The WooCommerce order is made under a short lease, after looking for an order that already carries this quote's id, so a retry, a
 *     crash or two simultaneous requests cannot make two orders.
 */
final class Customer
{
    /** How long one request may hold the right to make the order before another may take over. */
    public const LEASE_SECONDS = 120;

    public function __construct(private readonly Context $c, private readonly Payments $payments)
    {
    }

    /** @return array<string,mixed> {ok:false,status} or {ok:true,state,...} */
    public function view(string $ref, string $token): array
    {
        $quote = $this->open($ref, $token);
        if ($quote === null) {
            return ['ok' => false, 'status' => 'invalid_link'];
        }
        $now = $this->c->now();
        $state = match ($quote->status()) {
            Status::QUOTED => $quote->isExpiredAt($now) ? 'expired' : 'open',
            Status::APPROVED => $quote->payWindowOver($now) ? 'expired' : 'approved',
            Status::PAID, Status::IN_PRODUCTION, Status::COMPLETED => 'paid',
            Status::EXPIRED => 'expired',
            default => 'closed',
        };
        if ($state === 'expired' && in_array($quote->status(), [Status::QUOTED, Status::APPROVED], true)) {
            $this->payments->expireOne($quote);
            $quote = $this->c->repo->find($quote->id()) ?? $quote;
            if ($quote->status() === Status::PAID) {
                $state = 'paid';
            } elseif ($quote->status() === Status::APPROVED) {
                $state = 'approved';
            }
        }
        $view = $this->summary($quote, $state);
        if ($state === 'approved' && $quote->orderId() > 0) {
            $url = $this->c->orders->payUrl($quote->orderId());
            if ($url !== null) {
                $view['payUrl'] = $url;
            }
        }
        return $view;
    }

    /**
     * @param mixed $approval the decoded JSON object: {revision, line1, line2, city, state, postcode, country, phone, accepted}
     * @return array<string,mixed> {ok:true,status:'approved'|'already_approved',payUrl,...} or {ok:false,status,...}
     */
    public function approve(string $ref, string $token, mixed $approval): array
    {
        $check = ApprovalInput::validate($approval);
        if (!$check->ok || $check->value === null) {
            return ['ok' => false, 'status' => 'invalid_request', 'problems' => $check->issues];
        }
        $input = $check->value;
        $quote = $this->open($ref, $token);
        if ($quote === null) {
            return ['ok' => false, 'status' => 'invalid_link'];
        }
        $now = $this->c->now();

        if ($quote->status() === Status::APPROVED) {
            // A second click or a second tab: the same answer as the first, not a second order. (An approval of an older revision cannot
            // have got this far: approving bumps nothing, and revising an approved quote makes it Quoted with a new token.)
            return $this->afterApproval($quote->id());
        }
        if (in_array($quote->status(), [Status::PAID, Status::IN_PRODUCTION, Status::COMPLETED], true)) {
            return ['ok' => true, 'status' => 'already_paid'] + $this->summary($quote, 'paid');
        }
        if ($quote->status() !== Status::QUOTED) {
            return ['ok' => false, 'status' => $quote->status() === Status::EXPIRED ? 'expired' : 'not_open'];
        }
        if ($quote->isExpiredAt($now)) {
            $this->payments->expireOne($quote);
            return ['ok' => false, 'status' => 'expired'];
        }
        if ($input['revision'] !== $quote->revision()) {
            return ['ok' => false, 'status' => 'terms_changed'];
        }
        if (!$quote->hasOffer() || strtoupper($this->c->orders->currency()) !== $quote->currency() || $this->c->orders->decimals() !== 2) {
            $this->c->event($quote->id(), 'system', 'approve_refused', 'The offer could not be approved: the store currency or precision no longer matches the quote.');
            return ['ok' => false, 'status' => 'unavailable'];
        }

        $address = Json::encode([
            'line1' => $input['line1'], 'line2' => $input['line2'], 'city' => $input['city'], 'state' => $input['state'],
            'postcode' => $input['postcode'], 'country' => $input['country'],
        ]);
        $won = $this->c->repo->swap($quote->id(), [Status::QUOTED], [
            'status' => Status::APPROVED,
            'approved_at' => $now,
            'pay_by' => $now + $this->c->settings->payWindowSeconds,
            'address' => $address,
            'phone' => $input['phone'],
        ], ['revision' => $quote->revision(), 'token_hash' => $quote->tokenHash()], $now);
        if (!$won) {
            $latest = $this->c->repo->find($quote->id());
            if ($latest !== null && $latest->status() === Status::APPROVED) {
                return $this->afterApproval($latest->id());
            }
            return ['ok' => false, 'status' => $latest !== null && $latest->revision() !== $quote->revision() ? 'terms_changed' : 'not_open'];
        }
        $this->c->event($quote->id(), 'customer', 'approved', 'The customer approved revision ' . $quote->revision() . '.');

        $outcome = $this->afterApproval($quote->id());
        if (($outcome['ok'] ?? false) === true) {
            $approved = $this->c->repo->find($quote->id());
            if ($approved !== null) {
                $this->c->mailer->send($this->c->emails->approvedOwner($approved, $approved->orderId(), $this->c->adminUrl($approved->id()), $this->c->orders->adminUrl($approved->orderId())));
            }
        }
        return $outcome;
    }

    /**
     * An Approved quote needs exactly one order. Whoever gets here first (under the lease) makes it; everyone else is told it is being
     * made, or is handed the address of the one that exists.
     *
     * @return array<string,mixed>
     */
    private function afterApproval(int $id): array
    {
        $quote = $this->c->repo->find($id);
        if ($quote === null || $quote->status() !== Status::APPROVED) {
            return ['ok' => false, 'status' => 'not_open'];
        }
        if ($quote->orderId() > 0) {
            $url = $this->c->orders->payUrl($quote->orderId());
            return $url === null
                ? ['ok' => false, 'status' => 'not_payable']
                : ['ok' => true, 'status' => 'already_approved', 'payUrl' => $url] + $this->summary($quote, 'approved');
        }

        $now = $this->c->now();
        $lease = bin2hex(random_bytes(10));
        $claimed = $this->c->repo->swap($id, [Status::APPROVED], ['order_lease' => $lease, 'order_lease_at' => $now], ['order_id' => 0, 'order_lease' => ''], $now);
        if (!$claimed) {
            $fresh = $this->c->repo->find($id);
            if ($fresh !== null && $fresh->orderId() === 0 && $fresh->orderLease() !== '' && $fresh->orderLeaseAt() <= $now - self::LEASE_SECONDS) {
                // The request that held the lease is gone (a crash or a timeout): take over.
                $claimed = $this->c->repo->swap($id, [Status::APPROVED], ['order_lease' => $lease, 'order_lease_at' => $now], ['order_id' => 0, 'order_lease' => $fresh->orderLease()], $now);
            }
            if (!$claimed) {
                $again = $this->c->repo->find($id);
                if ($again !== null && $again->orderId() > 0) {
                    return $this->afterApproval($id);
                }
                return ['ok' => false, 'status' => 'busy'];
            }
        }

        $fingerprint = Fingerprint::ofQuote($this->c->settings->secret, $quote);
        try {
            $order = $this->c->orders->findByQuote($id) ?? $this->c->orders->createPendingOrder($quote, $this->addressOf($quote), $fingerprint);
        } catch (\Throwable $e) {
            // Nothing was charged and no order exists: put the quote back to "Quoted" so the same link can try again.
            $this->c->repo->swap($id, [Status::APPROVED], [
                'status' => Status::QUOTED, 'approved_at' => 0, 'pay_by' => 0, 'address' => '', 'phone' => '', 'order_lease' => '', 'order_lease_at' => 0,
            ], ['order_lease' => $lease, 'order_id' => 0], $this->c->now());
            $this->c->event($id, 'system', 'order_failed', 'The order could not be made: ' . mb_substr($e->getMessage(), 0, 300, 'UTF-8'));
            $this->c->flag($id, 'The customer approved the quote but WooCommerce could not make the order. They can try the link again. Details are in the history.', true);
            return ['ok' => false, 'status' => 'unavailable'];
        }
        $saved = $this->c->repo->swap($id, [Status::APPROVED], ['order_id' => $order->orderId, 'order_fp' => $fingerprint, 'order_lease' => '', 'order_lease_at' => 0], ['order_lease' => $lease, 'order_id' => 0], $this->c->now());
        if (!$saved) {
            $this->c->flag($id, 'Order #' . $order->orderId . ' was made for this quote but could not be saved on it. Check the quote and the order.', true);
        } else {
            $this->c->event($id, 'system', 'order_created', 'WooCommerce order #' . $order->orderId . ' was made and is waiting for payment.');
        }
        if ($order->payUrl === '') {
            return ['ok' => false, 'status' => 'not_payable'];
        }
        $latest = $this->c->repo->find($id) ?? $quote;
        return ['ok' => true, 'status' => 'approved', 'payUrl' => $order->payUrl] + $this->summary($latest, 'approved');
    }

    /** The quote for this reference and token, or null for either being wrong. */
    private function open(string $ref, string $token): ?Quote
    {
        $quote = \KcPrintworks\Quotes\Domain\Reference::valid($ref) ? $this->c->repo->findByRef($ref) : null;
        // Compare even when there is no such quote, so the time taken does not tell which references exist.
        $stored = $quote?->tokenHash() ?? hash('sha256', 'no such quote');
        $matches = Token::matches($token, $stored);
        return $quote !== null && $matches ? $quote : null;
    }

    /** @return array{line1:string,line2:string,city:string,state:string,postcode:string,country:string,phone:string} */
    private function addressOf(Quote $quote): array
    {
        $a = json_decode($quote->addressJson(), true);
        $a = is_array($a) ? $a : [];
        return [
            'line1' => (string) ($a['line1'] ?? ''), 'line2' => (string) ($a['line2'] ?? ''), 'city' => (string) ($a['city'] ?? ''),
            'state' => (string) ($a['state'] ?? ''), 'postcode' => (string) ($a['postcode'] ?? ''), 'country' => (string) ($a['country'] ?? ''),
            'phone' => $quote->phone(),
        ];
    }

    /** What the customer's page may show. Not their email, address, description, notes, the history or any order detail. @return array<string,mixed> */
    private function summary(Quote $quote, string $state): array
    {
        $first = explode(' ', $quote->name())[0];
        return [
            'ok' => true,
            'state' => $state,
            'ref' => $quote->ref(),
            'firstName' => $first,
            'project' => QuoteInput::PROJECT_TYPES[$quote->projectType()] ?? '',
            'quantity' => $quote->quantity(),
            'title' => $quote->title(),
            'details' => $quote->details(),
            'itemCents' => $quote->itemCents(),
            'shipCents' => $quote->shipCents(),
            'totalCents' => $quote->totalCents(),
            'currency' => $quote->currency(),
            'taxable' => $quote->taxable(),
            'revision' => $quote->revision(),
            'expiresAt' => $quote->expiresAt(),
            'payBy' => $quote->payBy(),
        ];
    }
}
