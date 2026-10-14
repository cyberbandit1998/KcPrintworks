<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Api;

use KcPrintworks\Etsy\Http\Response;

/** Rate-limit headers from the last response (names Confirmed from Etsy's rate-limit docs excerpt). */
final class Quota
{
    public function __construct(
        public readonly ?int $limitPerSecond,
        public readonly ?int $remainingThisSecond,
        public readonly ?int $limitPerDay,
        public readonly ?int $remainingToday,
    ) {
    }

    public static function fromResponse(Response $response): self
    {
        $int = static fn (?string $v): ?int => $v !== null && ctype_digit($v) ? (int) $v : null;
        return new self(
            $int($response->header('x-limit-per-second')),
            $int($response->header('x-remaining-this-second')),
            $int($response->header('x-limit-per-day')),
            $int($response->header('x-remaining-today')),
        );
    }

    /** Stop background work at 80% of the daily budget; the rest is kept for manual actions. */
    public function backgroundBudgetExhausted(): bool
    {
        if ($this->limitPerDay === null || $this->remainingToday === null || $this->limitPerDay === 0) {
            return false;
        }
        return $this->remainingToday <= (int) floor($this->limitPerDay * 0.2);
    }

    /** @return array<string,int|null> */
    public function toArray(): array
    {
        return [
            'limit_per_second' => $this->limitPerSecond,
            'remaining_this_second' => $this->remainingThisSecond,
            'limit_per_day' => $this->limitPerDay,
            'remaining_today' => $this->remainingToday,
        ];
    }
}
