<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Report;

use KcPrintworks\Etsy\Match\Decision;
use KcPrintworks\Etsy\Match\MatchReport;

/**
 * The product-matching report as a spreadsheet, with empty `owner_decision` and `owner_woo_id` columns to fill in.
 * Reading the filled-in file back produces Decision objects; it changes nothing in WooCommerce.
 */
final class MatchCsv
{
    private const HEADER = ['etsy_listing_id', 'etsy_title', 'etsy_state', 'status', 'evidence', 'reason', 'woo_product_id', 'woo_title', 'suggested_woo_id', 'candidates', 'other_matching_products', 'notes', 'owner_decision', 'owner_woo_id'];

    public static function render(MatchReport $report): string
    {
        $stream = fopen('php://temp', 'r+');
        fputcsv($stream, self::HEADER, ',', '"', '');
        foreach ($report->entries as $entry) {
            $woo = $entry->wooId !== null ? ($report->wooById[$entry->wooId] ?? null) : null;
            $candidates = [];
            foreach ($entry->candidates as $c) {
                $candidates[] = sprintf('#%d (score %d: %s)', $c->wooId, $c->score, implode('+', $c->signalTypes()));
            }
            fputcsv($stream, [
                $entry->listing->id,
                self::safe($entry->listing->title),
                self::safe($entry->listing->state),
                $entry->status,
                $entry->evidence,
                $entry->reason,
                $entry->wooId ?? '',
                self::safe($woo?->title ?? ''),
                $entry->suggestedWooId ?? '',
                self::safe(implode('; ', $candidates)),
                implode(' ', array_map(static fn (int $id): string => '#' . $id, $entry->unlinkedDuplicates)),
                self::safe(implode(' ', $entry->notes)),
                '',
                '',
            ], ',', '"', '');
        }
        rewind($stream);
        $csv = (string) stream_get_contents($stream);
        fclose($stream);
        return $csv;
    }

    /**
     * Spreadsheet formula injection: a cell that starts with = + - @ (or a tab or carriage return) is run as a formula by
     * Excel and Sheets. Titles come from Etsy and the website, so they are prefixed with an apostrophe.
     */
    private static function safe(string $text): string
    {
        return $text !== '' && strpbrk($text[0], "=+-@\t\r") !== false ? "'" . $text : $text;
    }

    /**
     * @return list<Decision>
     */
    public static function parseDecisions(string $csv, string $decidedBy = '', string $decidedAt = ''): array
    {
        $stream = fopen('php://temp', 'r+');
        fwrite($stream, $csv);
        rewind($stream);
        $header = fgetcsv($stream, 0, ',', '"', '');
        $decisions = [];
        if (!is_array($header)) {
            return [];
        }
        while (($row = fgetcsv($stream, 0, ',', '"', '')) !== false) {
            $data = [];
            foreach ($header as $i => $name) {
                $data[(string) $name] = trim((string) ($row[$i] ?? ''));
            }
            $type = strtolower($data['owner_decision'] ?? '');
            if ($type === '' || !ctype_digit($data['etsy_listing_id'] ?? '')) {
                continue;
            }
            $decisions[] = new Decision(
                (int) $data['etsy_listing_id'],
                $type,
                ($data['owner_woo_id'] ?? '') !== '' ? (int) ltrim($data['owner_woo_id'], '#') : null,
                $decidedBy,
                $decidedAt,
            );
        }
        fclose($stream);
        return $decisions;
    }
}
