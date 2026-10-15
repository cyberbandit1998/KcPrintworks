<?php
declare(strict_types=1);

namespace KcPrintworks\AddressAutocomplete;

/**
 * Address validation, the pure half: what the browser may send us, what we send Google's Address Validation API, and how Google's
 * answer becomes one of three plain verdicts. Pure PHP, tested without WordPress.
 *
 * The verdict is ADVICE for the customer ("this looks right", "please check it", "we could not find it"). It never blocks an order,
 * and the answer given back to the browser is only the verdict and a reason code, never Google's raw response.
 */
final class Validation
{
    public const OK = 'ok';
    public const CHECK = 'check';
    public const BAD = 'bad';
    public const UNKNOWN = 'unknown';

    /**
     * Reduces what the browser sent to the few fields the API takes, each limited in length and free of control characters.
     *
     * @return array{regionCode: string, postalCode: string, administrativeArea: string, locality: string, addressLines: list<string>}|null
     */
    public static function cleanAddress(mixed $raw): ?array
    {
        if (!is_array($raw)) {
            return null;
        }
        $text = static fn (mixed $v, int $max): string => is_string($v) ? mb_substr(trim((string) preg_replace('/[\x00-\x1f\x7f<>]+/u', ' ', $v)), 0, $max) : '';
        $region = strtoupper($text($raw['regionCode'] ?? '', 8));
        $lines = [];
        foreach (is_array($raw['addressLines'] ?? null) ? $raw['addressLines'] : [] as $line) {
            $clean = $text($line, 120);
            if ($clean !== '') {
                $lines[] = $clean;
            }
            if (count($lines) >= 3) {
                break;
            }
        }
        if (preg_match('/^[A-Z]{2}$/', $region) !== 1 || $lines === []) {
            return null;
        }
        return [
            'regionCode' => $region,
            'postalCode' => $text($raw['postalCode'] ?? '', 20),
            'administrativeArea' => $text($raw['administrativeArea'] ?? '', 60),
            'locality' => $text($raw['locality'] ?? '', 80),
            'addressLines' => $lines,
        ];
    }

    /**
     * The body of a validateAddress request. Empty parts are left out (the API treats a missing part as "not given").
     *
     * @param array{regionCode: string, postalCode: string, administrativeArea: string, locality: string, addressLines: list<string>} $address
     * @return array{address: array<string, mixed>}
     */
    public static function buildRequest(array $address): array
    {
        $body = ['regionCode' => $address['regionCode'], 'addressLines' => $address['addressLines']];
        foreach (['postalCode', 'administrativeArea', 'locality'] as $part) {
            if ($address[$part] !== '') {
                $body[$part] = $address[$part];
            }
        }
        return ['address' => $body];
    }

    /**
     * Google's verdict fields to ours. "ok" needs a complete address resolved down to the building (or very near it) with nothing
     * Google could not confirm or had to replace; "bad" is an incomplete address or one it could not place beyond a region.
     *
     * @param array<string, mixed> $response the decoded API response
     * @return array{verdict: string, reason: string}
     */
    public static function verdict(array $response): array
    {
        $v = $response['result']['verdict'] ?? null;
        if (!is_array($v)) {
            return ['verdict' => self::UNKNOWN, 'reason' => 'no_verdict'];
        }
        $granularity = (string) ($v['validationGranularity'] ?? '');
        if (($v['addressComplete'] ?? false) !== true) {
            return ['verdict' => self::BAD, 'reason' => 'incomplete'];
        }
        if (in_array($granularity, ['OTHER', 'GRANULARITY_UNSPECIFIED', ''], true)) {
            return ['verdict' => self::BAD, 'reason' => 'not_found'];
        }
        if (($v['hasUnconfirmedComponents'] ?? false) === true) {
            return ['verdict' => self::CHECK, 'reason' => 'unconfirmed'];
        }
        if (($v['hasReplacedComponents'] ?? false) === true) {
            return ['verdict' => self::CHECK, 'reason' => 'replaced'];
        }
        if (in_array($granularity, ['ROUTE', 'BLOCK'], true)) {
            return ['verdict' => self::CHECK, 'reason' => 'street_only'];
        }
        if (in_array($granularity, ['PREMISE', 'SUB_PREMISE', 'PREMISE_PROXIMITY'], true)) {
            return ['verdict' => self::OK, 'reason' => 'confirmed'];
        }
        return ['verdict' => self::CHECK, 'reason' => 'unclear'];
    }

    /**
     * Which usage error code a failed check counts as (one of {@see Usage::ERROR_CODES}), or null for a reason that is not a fault
     * ("no verdict" is Google's answer, not a failure).
     */
    public static function errorCode(string $reason): ?string
    {
        return match ($reason) {
            'quota' => 'quota',
            'auth' => 'auth',
            'api' => 'api',
            'network' => 'network',
            'bad_request' => 'request',
            'server', 'bad_response' => 'unknown',
            default => null,
        };
    }
}
