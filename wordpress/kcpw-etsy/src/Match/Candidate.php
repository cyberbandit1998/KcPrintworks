<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Match;

final class Candidate
{
    /** @param list<Signal> $signals */
    public function __construct(
        public readonly int $wooId,
        public readonly array $signals,
        public readonly int $score,
    ) {
    }

    public function strong(): bool
    {
        foreach ($this->signals as $signal) {
            if ($signal->strong()) {
                return true;
            }
        }
        return false;
    }

    /** @return list<string> */
    public function signalTypes(): array
    {
        return array_map(static fn (Signal $s): string => $s->type, $this->signals);
    }
}
