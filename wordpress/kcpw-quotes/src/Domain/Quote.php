<?php
declare(strict_types=1);

namespace KcPrintworks\Quotes\Domain;

/**
 * One custom quote, as stored. Built from a database row (or the memory store's copy of one); never mutated: every change goes through
 * the repository, which returns a fresh copy. All times are unix seconds (UTC); all money is whole cents.
 */
final class Quote
{
    /** @param array<string,mixed> $row */
    private function __construct(private readonly array $row)
    {
    }

    /** @param array<string,mixed> $row */
    public static function fromRow(array $row): self
    {
        return new self($row);
    }

    /** @return array<string,mixed> */
    public function toRow(): array
    {
        return $this->row;
    }

    public function id(): int { return (int) $this->row['id']; }
    public function ref(): string { return (string) $this->row['ref']; }
    public function status(): string { return (string) $this->row['status']; }
    public function createdAt(): int { return (int) $this->row['created_at']; }
    public function updatedAt(): int { return (int) $this->row['updated_at']; }

    public function name(): string { return (string) $this->row['name']; }
    public function email(): string { return (string) $this->row['email']; }
    public function projectType(): string { return (string) $this->row['project_type']; }
    public function game(): string { return (string) $this->row['game']; }
    public function description(): string { return (string) $this->row['description']; }
    public function dimensions(): string { return (string) $this->row['dimensions']; }
    public function quantity(): int { return (int) $this->row['quantity']; }
    public function colors(): string { return (string) $this->row['colors']; }
    public function deadline(): string { return (string) $this->row['deadline']; }
    public function shipTo(): string { return (string) $this->row['ship_to']; }
    public function clientHash(): string { return (string) $this->row['client_hash']; }

    /** What the owner is offering. */
    public function title(): string { return (string) $this->row['quote_title']; }
    public function details(): string { return (string) $this->row['quote_details']; }
    public function itemCents(): int { return (int) $this->row['item_cents']; }
    public function shipCents(): int { return (int) $this->row['ship_cents']; }
    public function totalCents(): int { return $this->itemCents() + $this->shipCents(); }
    public function currency(): string { return (string) $this->row['currency']; }
    public function taxable(): bool { return (int) $this->row['taxable'] === 1; }
    public function hasOffer(): bool { return $this->title() !== '' && $this->totalCents() > 0; }

    /** 0 until the first quote is sent; +1 every time a quote is (re)sent. An approval only counts for the revision the customer saw. */
    public function revision(): int { return (int) $this->row['revision']; }
    public function quotedAt(): int { return (int) $this->row['quoted_at']; }
    /** The offer can be approved until this time (0 = no offer yet). */
    public function expiresAt(): int { return (int) $this->row['expires_at']; }
    public function approvedAt(): int { return (int) $this->row['approved_at']; }
    /** After approving, the order must be paid by this time (0 = not approved). */
    public function payBy(): int { return (int) $this->row['pay_by']; }
    public function paidAt(): int { return (int) $this->row['paid_at']; }

    /** SHA-256 of the secret link token; the token itself is never stored. '' = no live link. */
    public function tokenHash(): string { return (string) $this->row['token_hash']; }
    public function orderId(): int { return (int) $this->row['order_id']; }
    public function orderFingerprint(): string { return (string) $this->row['order_fp']; }
    /** Set while one request is making the order; another request must not make a second. */
    public function orderLease(): string { return (string) $this->row['order_lease']; }
    public function orderLeaseAt(): int { return (int) $this->row['order_lease_at']; }

    /** The address the customer typed when approving (needed for the order), as JSON; '' until then. */
    public function addressJson(): string { return (string) $this->row['address']; }
    public function phone(): string { return (string) $this->row['phone']; }

    /** Something needs a person: a payment arrived that did not match the offer, an order was changed by hand, an email failed. */
    public function needsAttention(): bool { return (int) $this->row['attention'] === 1; }
    public function attentionReason(): string { return (string) $this->row['attention_reason']; }
    public function erased(): bool { return (int) $this->row['erased'] === 1; }

    public function isExpiredAt(int $now): bool
    {
        return $this->expiresAt() > 0 && $now >= $this->expiresAt();
    }

    public function payWindowOver(int $now): bool
    {
        return $this->payBy() > 0 && $now >= $this->payBy();
    }
}
