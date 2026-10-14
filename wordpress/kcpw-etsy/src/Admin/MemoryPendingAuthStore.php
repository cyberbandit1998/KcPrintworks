<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Admin;

final class MemoryPendingAuthStore implements PendingAuthStore
{
    /** @var array<string,array{verifier:string,user:string,created:int}> */
    private array $entries = [];

    /** @param (callable():int)|null $clock */
    public function __construct(private $clock = null)
    {
        $this->clock = $clock ?? static fn (): int => time();
    }

    public function put(string $state, string $codeVerifier, string $userLabel): void
    {
        $this->entries[$state] = ['verifier' => $codeVerifier, 'user' => $userLabel, 'created' => ($this->clock)()];
    }

    public function take(string $state): ?array
    {
        $entry = $this->entries[$state] ?? null;
        unset($this->entries[$state]);
        if ($entry === null || ($this->clock)() - $entry['created'] > 600) {
            return null;
        }
        return $entry;
    }
}
