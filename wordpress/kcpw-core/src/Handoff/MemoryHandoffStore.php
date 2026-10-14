<?php
declare(strict_types=1);

namespace KcPrintworks\Core\Handoff;

final class MemoryHandoffStore implements HandoffStore
{
    /** @var array<string,array{0:string,1:int}> */
    public array $rows = [];

    public function put(string $tokenHash, string $payloadJson, int $expiresAt): void
    {
        $this->rows[$tokenHash] = [$payloadJson, $expiresAt];
    }

    public function take(string $tokenHash, int $now): ?string
    {
        $row = $this->rows[$tokenHash] ?? null;
        unset($this->rows[$tokenHash]);
        return $row !== null && $row[1] >= $now ? $row[0] : null;
    }
}
