<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Snapshot;

interface RunStateStore
{
    public function load(): RunState;

    public function save(RunState $state): void;
}
