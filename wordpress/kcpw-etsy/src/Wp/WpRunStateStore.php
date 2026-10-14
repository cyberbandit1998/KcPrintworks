<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Wp;

use KcPrintworks\Etsy\Snapshot\RunState;
use KcPrintworks\Etsy\Snapshot\RunStateStore;

final class WpRunStateStore implements RunStateStore
{
    public const OPTION = 'kcpw_etsy_run_state';

    public function load(): RunState
    {
        $data = \get_option(self::OPTION, []);
        return is_array($data) ? RunState::fromArray($data) : new RunState();
    }

    public function save(RunState $state): void
    {
        \update_option(self::OPTION, $state->toArray(), false);
    }
}
