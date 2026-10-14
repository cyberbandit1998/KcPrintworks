<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Snapshot;

final class MemoryRunStateStore implements RunStateStore
{
    public function __construct(private RunState $state = new RunState())
    {
    }

    public function load(): RunState
    {
        return $this->state;
    }

    public function save(RunState $state): void
    {
        $this->state = $state;
    }
}
