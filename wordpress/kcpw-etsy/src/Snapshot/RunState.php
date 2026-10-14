<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Snapshot;

/** Progress and outcome of one snapshot run, shown on the admin screen. */
final class RunState
{
    public const IDLE = 'idle';
    public const LISTING = 'listing';
    public const DETAILS = 'details';
    public const DONE = 'done';
    public const FAILED = 'failed';
    public const PAUSED = 'paused';

    /**
     * @param list<string> $errors
     * @param array<string,int|null> $quota
     */
    public function __construct(
        public string $phase = self::IDLE,
        public string $startedAt = '',
        public string $finishedAt = '',
        public int $listings = 0,
        public int $detailsDone = 0,
        public int $detailsFailed = 0,
        public array $errors = [],
        public array $quota = [],
        public string $trigger = 'manual',
        /** @var list<int> */
        public array $failedIds = [],
    ) {
    }

    public function running(): bool
    {
        return in_array($this->phase, [self::LISTING, self::DETAILS], true);
    }

    /** @return array<string,mixed> */
    public function toArray(): array
    {
        return get_object_vars($this);
    }

    /** @param array<string,mixed> $data */
    public static function fromArray(array $data): self
    {
        $state = new self();
        foreach ($data as $key => $value) {
            if (property_exists($state, $key)) {
                $state->$key = $value;
            }
        }
        return $state;
    }
}
