<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Sync;

/** One field of one product in a dry-run plan: what is there, what Etsy says, who owns it, and what would happen. */
final class PlanItem
{
    public const IN_SYNC = 'in_sync';
    public const CHANGE = 'change';
    public const CONFLICT = 'conflict';
    public const WEBSITE_EDIT = 'website_edit';
    public const SKIPPED_OVERRIDE = 'skipped_override';
    public const SUGGESTION = 'suggestion';
    public const FLAG = 'flag';
    public const UNTOUCHED = 'untouched';

    public const RISK_LOW = 'low';
    public const RISK_MEDIUM = 'medium';
    public const RISK_HIGH = 'high';

    public function __construct(
        public readonly string $field,
        public readonly string $owner,
        public readonly string $status,
        public readonly mixed $before,
        public readonly mixed $after,
        public readonly string $risk = self::RISK_LOW,
        public readonly string $note = '',
    ) {
    }

    /** @return array<string,mixed> */
    public function toArray(): array
    {
        return [
            'field' => $this->field,
            'owner' => $this->owner,
            'status' => $this->status,
            'before' => $this->before,
            'after' => $this->after,
            'risk' => $this->risk,
            'note' => $this->note,
        ];
    }
}
