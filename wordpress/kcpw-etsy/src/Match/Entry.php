<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Match;

use KcPrintworks\Etsy\Model\Listing;

/** The matching result for one Etsy listing. */
final class Entry
{
    public const MAPPED = 'mapped';
    public const MAPPED_MISSING = 'mapped_missing';
    public const APPROVED = 'approved';
    public const APPROVED_NEW = 'approved_new';
    public const PROPOSED = 'proposed';
    public const AMBIGUOUS = 'ambiguous';
    public const NEW = 'new';
    public const IGNORED = 'ignored';

    public const EVIDENCE_IDENTIFIER = 'identifier';
    public const EVIDENCE_TEXTUAL = 'textual';
    public const EVIDENCE_NONE = 'none';

    public const REASON_DUPLICATES = 'duplicate_candidates';
    public const REASON_TITLE_ONLY = 'title_only';
    public const REASON_CLAIMED = 'claimed_by_other_listing';
    public const REASON_INVALID_DECISION = 'invalid_decision';

    /**
     * @param list<Candidate> $candidates best first
     * @param list<string> $notes
     * @param list<int> $unlinkedDuplicates Woo products that match too but were not chosen (later: retire, never delete here)
     */
    public function __construct(
        public Listing $listing,
        public string $status,
        public array $candidates = [],
        public ?int $wooId = null,
        public string $reason = '',
        public ?int $suggestedWooId = null,
        public array $notes = [],
        public array $unlinkedDuplicates = [],
        public string $evidence = self::EVIDENCE_NONE,
    ) {
    }

    /** True when nothing more is needed from the owner before a first sync could use this match. */
    public function settled(): bool
    {
        return in_array($this->status, [self::MAPPED, self::APPROVED, self::APPROVED_NEW, self::IGNORED], true);
    }
}
