<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Report;

use KcPrintworks\Etsy\Match\Entry;
use KcPrintworks\Etsy\Match\MatchReport;
use KcPrintworks\Etsy\Sync\Plan;
use KcPrintworks\Etsy\Sync\PlanItem;

/** A readable summary of the match report and the dry-run plan. */
final class MarkdownReport
{
    public static function render(MatchReport $report, Plan $plan, string $source): string
    {
        $c = $report->counts();
        $lines = [
            '# Etsy to WooCommerce: import preview (read-only)',
            '',
            'Source: ' . $source,
            '',
            '**Nothing was created, changed, or deleted in WooCommerce.** This is a preview for you to review.',
            '',
            '## Matching',
            '',
            '| Result | Listings |',
            '|---|---|',
            '| Already mapped | ' . $c[Entry::MAPPED] . ' |',
            '| Approved by you | ' . ($c[Entry::APPROVED] + $c[Entry::APPROVED_NEW]) . ' |',
            '| Proposed (needs your approval) | ' . $c[Entry::PROPOSED] . ' |',
            '| **Ambiguous (you must choose)** | ' . $c[Entry::AMBIGUOUS] . ' |',
            '| New on Etsy, no website product | ' . $c[Entry::NEW] . ' |',
            '| Mapped to a missing product | ' . $c[Entry::MAPPED_MISSING] . ' |',
            '| Ignored by you | ' . $c[Entry::IGNORED] . ' |',
            '| WooCommerce products with no Etsy listing | ' . $c['woo_only'] . ' |',
            '',
        ];
        $ambiguous = array_filter($report->entries, static fn (Entry $e): bool => $e->status === Entry::AMBIGUOUS);
        if ($ambiguous !== []) {
            $lines[] = '### Needs your decision';
            $lines[] = '';
            foreach ($ambiguous as $e) {
                $lines[] = sprintf('- **#%d** %s: %s', $e->listing->id, $e->listing->title, $e->reason);
                foreach ($e->candidates as $cand) {
                    $title = $report->wooById[$cand->wooId]->title ?? '';
                    $lines[] = sprintf('  - Woo #%d "%s" (score %d: %s)', $cand->wooId, $title, $cand->score, implode(', ', $cand->signalTypes()));
                }
                foreach ($e->notes as $note) {
                    $lines[] = '  - ' . $note;
                }
            }
            $lines[] = '';
        }
        $t = $plan->totals();
        $lines[] = '## Dry-run plan';
        $lines[] = '';
        $lines[] = sprintf('%d products in the plan: %d approved, %d preview only, %d with proposed changes, %d with conflicts, %d new drafts. Plan fingerprint: `%s`.', $t['entries'], $t['approved'], $t['preview_only'], $t['with_changes'], $t['conflicts'], $t['create_draft'], substr($plan->hash(), 0, 12));
        $lines[] = '';
        $high = [];
        foreach ($plan->entries as $entry) {
            foreach ($entry->items as $item) {
                if ($item->risk === PlanItem::RISK_HIGH && in_array($item->status, [PlanItem::CHANGE, PlanItem::CONFLICT, PlanItem::WEBSITE_EDIT], true)) {
                    $high[] = sprintf('- #%d %s: **%s** (%s) %s', $entry->listingId, $entry->listingTitle, $item->field, $item->status, $item->note);
                }
            }
        }
        if ($high !== []) {
            $lines[] = '### High-risk changes to review';
            $lines[] = '';
            array_push($lines, ...$high);
            $lines[] = '';
        }
        return implode("\n", $lines) . "\n";
    }
}
