<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Wp;

use KcPrintworks\Etsy\Admin\Scheduler;

/** WP-Cron single events for the next background step. (A system cron running `wp cron event run --due-now` also works.) */
final class WpScheduler implements Scheduler
{
    public const BATCH_HOOK = 'kcpw_etsy_snapshot_batch';
    public const DAILY_HOOK = 'kcpw_etsy_daily_refresh';

    public function scheduleBatch(int $delaySeconds = 2): void
    {
        if (!\wp_next_scheduled(self::BATCH_HOOK)) {
            \wp_schedule_single_event(time() + max(1, $delaySeconds), self::BATCH_HOOK);
        }
    }

    public function cancel(): void
    {
        \wp_clear_scheduled_hook(self::BATCH_HOOK);
        \wp_clear_scheduled_hook(self::DAILY_HOOK);
    }
}
