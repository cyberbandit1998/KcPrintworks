<?php
declare(strict_types=1);

namespace KcPrintworks\AddressAutocomplete;

/**
 * Usage counters: how many suggestion requests, selections and failures this site's visitors caused, per day.
 *
 * PRIVACY RULE (enforced by this class, not by good intentions): a counter is a whole number, nothing else. There is no field for
 * what a visitor typed, for an address, a place, a country, an IP address or a user, so no caller can store one by mistake. The beacon
 * a browser sends is reduced to this shape by {@see Usage::cleanBeacon()}; anything else in it is dropped.
 *
 * These numbers come from visitors' browsers, so they are an estimate for the owner's own planning ("roughly how many requests am I
 * paying Google for?"), not a bill: Google's own Cloud Console is the authority.
 */
final class Usage
{
    public const OPTION = 'kcpw_aa_usage';
    public const KEEP_DAYS = 60;

    /** What each kind of counter means. */
    public const COUNTERS = [
        'r' => 'requests', 'd' => 'details', 's' => 'selections', 'm' => 'manual',
        // Counted by this server, never accepted from a browser: address checks made, and (opt-in) checkouts started and completed.
        'v' => 'validations', 'cs' => 'checkoutsStarted', 'cc' => 'checkoutsCompleted',
    ];

    /** The only failure codes a beacon may carry. */
    public const ERROR_CODES = ['auth', 'api', 'quota', 'billing', 'script', 'conflict', 'timeout', 'network', 'request', 'details', 'unknown'];

    /** One browser cannot add more than this to a single day's totals in one beacon. */
    private const MAX_PER_BEACON = ['r' => 40, 'd' => 20, 's' => 20, 'm' => 20];
    private const MAX_ERROR_PER_BEACON = 20;

    /**
     * @param mixed $raw decoded JSON from the browser
     * @return array{r: int, d: int, s: int, m: int, e: array<string, int>}|null null when it holds nothing countable
     */
    public static function cleanBeacon(mixed $raw): ?array
    {
        if (!is_array($raw)) {
            return null;
        }
        $out = ['r' => 0, 'd' => 0, 's' => 0, 'm' => 0, 'e' => []];
        $any = false;
        foreach (self::MAX_PER_BEACON as $key => $max) {
            $value = $raw[$key] ?? 0;
            if (is_int($value) || (is_string($value) && ctype_digit($value))) {
                $out[$key] = max(0, min($max, (int) $value));
                $any = $any || $out[$key] > 0;
            }
        }
        $errors = is_array($raw['e'] ?? null) ? $raw['e'] : [];
        foreach (self::ERROR_CODES as $code) {
            $value = $errors[$code] ?? 0;
            if (is_int($value) || (is_string($value) && ctype_digit($value))) {
                $n = max(0, min(self::MAX_ERROR_PER_BEACON, (int) $value));
                if ($n > 0) {
                    $out['e'][$code] = $n;
                    $any = true;
                }
            }
        }
        return $any ? $out : null;
    }

    /**
     * Adds one cleaned beacon to the stored days and drops days older than KEEP_DAYS.
     *
     * @param mixed $stored
     * @param array<string, mixed> $beacon
     * @return array{days: array<string, array<string, mixed>>}
     */
    public static function record(mixed $stored, array $beacon, string $today): array
    {
        $days = is_array($stored) && is_array($stored['days'] ?? null) ? $stored['days'] : [];
        $row = is_array($days[$today] ?? null) ? $days[$today] : [];
        foreach (array_keys(self::COUNTERS) as $key) {
            $row[$key] = (int) ($row[$key] ?? 0) + (int) ($beacon[$key] ?? 0);
        }
        $errors = is_array($row['e'] ?? null) ? $row['e'] : [];
        foreach ($beacon['e'] ?? [] as $code => $n) {
            $errors[$code] = (int) ($errors[$code] ?? 0) + $n;
        }
        $row['e'] = $errors;
        $days[$today] = $row;

        ksort($days);
        $cut = gmdate('Y-m-d', strtotime($today . ' UTC') - self::KEEP_DAYS * 86400);
        foreach (array_keys($days) as $day) {
            if ((string) $day < $cut) {
                unset($days[$day]);
            }
        }
        return ['days' => $days];
    }

    /**
     * Adds numbers this SERVER counted itself (not a browser's report): `['v' => 1]`, `['cs' => 1]`, `['cc' => 1]`.
     *
     * @param mixed $stored
     * @param array<string, int> $add
     * @return array{days: array<string, array<string, mixed>>}
     */
    public static function bump(mixed $stored, array $add, string $today): array
    {
        $beacon = [];
        foreach (['v', 'cs', 'cc'] as $key) {
            $beacon[$key] = max(0, min(1000, (int) ($add[$key] ?? 0)));
        }
        return self::record($stored, $beacon, $today);
    }

    /**
     * Totals over the last `$days` days, plus the per-day rows for a small table.
     *
     * @param mixed $stored
     * @return array{totals: array<string, int>, errors: array<string, int>, rows: list<array<string, mixed>>}
     */
    public static function summary(mixed $stored, int $days, string $today): array
    {
        $stored = is_array($stored) && is_array($stored['days'] ?? null) ? $stored['days'] : [];
        $totals = array_fill_keys(array_values(self::COUNTERS), 0);
        $errors = [];
        $rows = [];
        $todayTime = strtotime($today . ' UTC');
        for ($i = 0; $i < $days; $i++) {
            $day = gmdate('Y-m-d', $todayTime - $i * 86400);
            $row = is_array($stored[$day] ?? null) ? $stored[$day] : [];
            $entry = ['day' => $day];
            foreach (self::COUNTERS as $key => $name) {
                $entry[$name] = (int) ($row[$key] ?? 0);
                $totals[$name] += $entry[$name];
            }
            $entry['errors'] = 0;
            foreach (is_array($row['e'] ?? null) ? $row['e'] : [] as $code => $n) {
                $errors[$code] = ($errors[$code] ?? 0) + (int) $n;
                $entry['errors'] += (int) $n;
            }
            if (array_sum(array_intersect_key($entry, array_flip(array_values(self::COUNTERS)))) > 0 || $entry['errors']) {
                $rows[] = $entry;
            }
        }
        arsort($errors);
        return ['totals' => $totals, 'errors' => $errors, 'rows' => $rows];
    }
}
