<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Admin;

/** Runs the next snapshot batch in the background (WP-Cron in WordPress). */
interface Scheduler
{
    public function scheduleBatch(int $delaySeconds = 2): void;

    public function cancel(): void;
}
