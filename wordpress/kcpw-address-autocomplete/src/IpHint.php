<?php
declare(strict_types=1);

namespace KcPrintworks\AddressAutocomplete;

/**
 * The opt-in "where is this visitor, roughly" hint that makes the suggestions favor nearby places. It only ever softens the ranking of
 * suggestions: it never restricts them and never fills an address. OFF until the owner switches it on.
 *
 * Two sources: the country header a CDN such as Cloudflare adds (no outside call at all), or an IP lookup service the owner names
 * (the visitor's IP address is then sent to that service). Pure parsing and checking lives here; the caching and the HTTP call are in
 * {@see Rest}.
 */
final class IpHint
{
    /**
     * @param array<string, mixed> $server $_SERVER
     * @return array{country: string}|null
     */
    public static function fromHeader(array $server): ?array
    {
        $code = isset($server['HTTP_CF_IPCOUNTRY']) && is_string($server['HTTP_CF_IPCOUNTRY']) ? strtoupper(trim($server['HTTP_CF_IPCOUNTRY'])) : '';
        // XX is "unknown" and T1 is "Tor" in Cloudflare's header; neither is a country.
        return preg_match('/^[A-Z]{2}$/', $code) === 1 && !in_array($code, ['XX', 'T1'], true) ? ['country' => $code] : null;
    }

    /** A public (not private, not reserved) IPv4 or IPv6 address. */
    public static function isPublicIp(string $ip): bool
    {
        return filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE) !== false;
    }

    /** The service address with {ip} replaced, or null when the visitor's address is not a public one. */
    public static function serviceUrl(string $template, string $ip): ?string
    {
        if (!self::isPublicIp($ip) || Settings::ipServiceUrl($template) === '') {
            return null;
        }
        return str_replace('{ip}', rawurlencode($ip), $template);
    }

    /**
     * Reads the usual field names of IP lookup services.
     *
     * @param array<string, mixed> $json
     * @return array{country: string, lat?: float, lng?: float}|null
     */
    public static function parseService(array $json): ?array
    {
        $country = '';
        foreach (['country_code', 'countryCode', 'country'] as $key) {
            if (isset($json[$key]) && is_string($json[$key]) && preg_match('/^[A-Za-z]{2}$/', $json[$key]) === 1) {
                $country = strtoupper($json[$key]);
                break;
            }
        }
        if ($country === '') {
            return null;
        }
        $out = ['country' => $country];
        $lat = $json['latitude'] ?? $json['lat'] ?? null;
        $lng = $json['longitude'] ?? $json['lon'] ?? $json['lng'] ?? null;
        if (is_numeric($lat) && is_numeric($lng) && abs((float) $lat) <= 90 && abs((float) $lng) <= 180) {
            // A lookup by IP is only as good as a city; round it so nothing finer than that is ever kept or sent on.
            $out['lat'] = round((float) $lat, 1);
            $out['lng'] = round((float) $lng, 1);
        }
        return $out;
    }
}
