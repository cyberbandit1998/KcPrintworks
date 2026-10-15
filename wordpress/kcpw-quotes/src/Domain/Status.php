<?php
declare(strict_types=1);

namespace KcPrintworks\Quotes\Domain;

/**
 * The ten states of a custom quote and the moves between them. There are two kinds of move:
 *
 *   - MANUAL: what the owner can choose in the status box. Only the safe, undo-able ones; a quote cannot be made "Approved" or "Paid" by hand,
 *     because those two are facts (the customer approved through the secure link; WooCommerce received the payment).
 *   - WORKFLOW: made by the plugin itself (sending a quote, the customer approving, a payment arriving, a quote running out of time).
 *
 * Every change is applied with a compare-and-swap in the repository (UPDATE ... WHERE status IN (the allowed starting states)), so two
 * people or two requests can never both succeed at the same move.
 */
final class Status
{
    public const NEW = 'new';
    public const REVIEWING = 'reviewing';
    public const QUOTED = 'quoted';
    public const APPROVED = 'approved';
    public const PAID = 'paid';
    public const IN_PRODUCTION = 'in_production';
    public const COMPLETED = 'completed';
    public const DECLINED = 'declined';
    public const EXPIRED = 'expired';
    public const CANCELLED = 'cancelled';

    /** In the order the dashboard shows them. */
    public const LABELS = [
        self::NEW => 'New',
        self::REVIEWING => 'Reviewing',
        self::QUOTED => 'Quoted',
        self::APPROVED => 'Approved',
        self::PAID => 'Paid',
        self::IN_PRODUCTION => 'In Production',
        self::COMPLETED => 'Completed',
        self::DECLINED => 'Declined',
        self::EXPIRED => 'Expired',
        self::CANCELLED => 'Cancelled',
    ];

    /** What the owner may choose by hand, from each state. */
    private const MANUAL = [
        self::NEW => [self::REVIEWING, self::DECLINED, self::CANCELLED],
        self::REVIEWING => [self::NEW, self::DECLINED, self::CANCELLED],
        // Taking a quote back ("withdraw") also makes its link stop working.
        self::QUOTED => [self::REVIEWING, self::DECLINED, self::CANCELLED],
        // Cancelling an approved quote also cancels the unpaid order made for it.
        self::APPROVED => [self::CANCELLED],
        self::PAID => [self::IN_PRODUCTION],
        self::IN_PRODUCTION => [self::COMPLETED],
        self::COMPLETED => [],
        self::DECLINED => [self::REVIEWING],
        self::EXPIRED => [self::REVIEWING],
        self::CANCELLED => [],
    ];

    /** States from which a quote (re)sent to the customer becomes "Quoted" (a first quote, a revision, a revision after it ran out). */
    public const CAN_SEND_QUOTE_FROM = [self::NEW, self::REVIEWING, self::QUOTED, self::EXPIRED, self::APPROVED];

    /** States in which the owner may still change what is being offered (price, shipping, wording, expiry). */
    public const TERMS_EDITABLE = [self::NEW, self::REVIEWING, self::QUOTED, self::EXPIRED];

    /** States in which a customer's link still shows the offer (and in which an offer can be accepted or paid). */
    public const OPEN_FOR_APPROVAL = [self::QUOTED];

    /** Quotes that are finished one way or another: nothing more will happen to them on its own. */
    public const FINAL = [self::COMPLETED, self::DECLINED, self::CANCELLED];

    public static function isKnown(string $status): bool
    {
        return isset(self::LABELS[$status]);
    }

    public static function label(string $status): string
    {
        return self::LABELS[$status] ?? 'Unknown';
    }

    /** @return list<string> */
    public static function manualTargets(string $from): array
    {
        return self::MANUAL[$from] ?? [];
    }

    public static function canChangeByHand(string $from, string $to): bool
    {
        return in_array($to, self::MANUAL[$from] ?? [], true);
    }

    /** @return list<string> */
    public static function all(): array
    {
        return array_keys(self::LABELS);
    }
}
