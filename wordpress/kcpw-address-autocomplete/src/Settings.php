<?php
declare(strict_types=1);

namespace KcPrintworks\AddressAutocomplete;

/**
 * Global settings: defaults and strict sanitizing. Pure PHP (no WordPress calls), so every rule is tested without WordPress.
 *
 * Safety defaults, in order of importance:
 *  - `mode` is `preview` (administrators only) until the owner switches it to `live`;
 *  - every optional module is off, and the three opt-ins (webhook, abandonment counting, IP-based location) are off and need an explicit
 *    switch (the webhook also needs a consent tick and a valid https address);
 *  - nothing here ever holds a customer's address: the usage counters are plain numbers.
 */
final class Settings
{
    public const OPTION = 'kcpw_aa_settings';

    public const MODE_OFF = 'off';
    public const MODE_PREVIEW = 'preview';
    public const MODE_LIVE = 'live';

    /** Settings groups, each saved by its own form so one tab can never wipe another tab's values. */
    public const SECTIONS = ['general', 'behavior', 'style', 'modules', 'optins'];

    public const MAX_COUNTRIES = 5;

    /** Which Places type filter each choice means. `business` is filtered in the browser, not by Google (see assets/js/kcpw-aa.js). */
    public const PLACE_TYPES = ['address', 'all', 'cities', 'regions', 'business'];

    public const THEMES = ['match', 'light', 'dark', 'system'];

    /** @return array<string, mixed> */
    public static function defaults(): array
    {
        return [
            'mode' => self::MODE_PREVIEW,
            'browser_key' => '',
            'server_key' => '',
            'countries' => [],
            'language' => '',
            'min_chars' => 3,
            'debounce_ms' => 300,
            'max_requests' => 12,
            'place_types' => 'address',
            'disable_autofill' => true,
            'show_fallback_notice' => true,
            'usage_counters' => true,
            'theme' => 'match',
            'accent' => '#2b59e6',
            'radius' => 8,
            'modules' => [
                'map_picker' => false,
                'gps' => false,
                'validation' => false,
                'pobox' => false,
            ],
            'pobox_mode' => 'warn',
            'map_id' => 'DEMO_MAP_ID',
            'optins' => [
                'webhook' => ['enabled' => false, 'consent' => false, 'url' => '', 'include_address' => false, 'events' => ['bad']],
                'abandonment' => ['enabled' => false],
                'ip' => ['enabled' => false, 'source' => 'header', 'service_url' => ''],
            ],
            'wizard_done' => false,
        ];
    }

    /**
     * The stored value merged over the defaults, with every field forced back into its allowed range, so a hand-edited or old
     * option can never produce a value the rest of the plugin has not been written for.
     *
     * @param mixed $stored
     * @return array<string, mixed>
     */
    public static function load(mixed $stored): array
    {
        $stored = is_array($stored) ? $stored : [];
        $merged = self::defaults();
        foreach (self::SECTIONS as $section) {
            $merged = self::applySection($merged, $stored, $section);
        }
        $merged['wizard_done'] = ($stored['wizard_done'] ?? false) === true;
        return $merged;
    }

    /**
     * Applies the submitted fields of ONE section over the current settings. Fields the form did not send keep their value.
     *
     * @param array<string, mixed> $current
     * @param array<string, mixed> $raw     unslashed form input
     * @return array<string, mixed>
     */
    public static function applySection(array $current, array $raw, string $section): array
    {
        $out = $current;
        switch ($section) {
            case 'general':
                if (isset($raw['mode'])) {
                    $out['mode'] = in_array($raw['mode'], [self::MODE_OFF, self::MODE_PREVIEW, self::MODE_LIVE], true) ? $raw['mode'] : $current['mode'];
                }
                // A key field left blank keeps the saved key (the page never prints a saved key back); the "remove" tick clears it.
                foreach (['browser_key', 'server_key'] as $name) {
                    if (!empty($raw['clear_' . $name])) {
                        $out[$name] = '';
                    } elseif (isset($raw[$name]) && is_string($raw[$name]) && trim($raw[$name]) !== '') {
                        $out[$name] = self::apiKey($raw[$name], (string) $current[$name]);
                    }
                }
                if (array_key_exists('countries', $raw)) {
                    $out['countries'] = self::countries($raw['countries']);
                }
                if (isset($raw['language'])) {
                    $out['language'] = self::language($raw['language']);
                }
                break;

            case 'behavior':
                if (isset($raw['min_chars'])) {
                    $out['min_chars'] = self::intRange($raw['min_chars'], 2, 6, (int) $current['min_chars']);
                }
                if (isset($raw['debounce_ms'])) {
                    $out['debounce_ms'] = self::intRange($raw['debounce_ms'], 200, 1000, (int) $current['debounce_ms']);
                }
                if (isset($raw['max_requests'])) {
                    $out['max_requests'] = self::intRange($raw['max_requests'], 3, 40, (int) $current['max_requests']);
                }
                if (isset($raw['place_types'])) {
                    $out['place_types'] = in_array($raw['place_types'], self::PLACE_TYPES, true) ? $raw['place_types'] : $current['place_types'];
                }
                foreach (['disable_autofill', 'show_fallback_notice', 'usage_counters'] as $flag) {
                    if (array_key_exists($flag, $raw)) {
                        $out[$flag] = self::flag($raw[$flag]);
                    }
                }
                break;

            case 'style':
                if (isset($raw['theme'])) {
                    $out['theme'] = in_array($raw['theme'], self::THEMES, true) ? $raw['theme'] : $current['theme'];
                }
                if (isset($raw['accent'])) {
                    $out['accent'] = self::color($raw['accent'], (string) $current['accent']);
                }
                if (isset($raw['radius'])) {
                    $out['radius'] = self::intRange($raw['radius'], 0, 24, (int) $current['radius']);
                }
                break;

            case 'modules':
                $modules = is_array($current['modules'] ?? null) ? $current['modules'] : [];
                if (isset($raw['modules']) && is_array($raw['modules'])) {
                    foreach (array_keys(self::defaults()['modules']) as $name) {
                        if (array_key_exists($name, $raw['modules'])) {
                            $modules[$name] = self::flag($raw['modules'][$name]);
                        }
                    }
                }
                $out['modules'] = $modules;
                if (isset($raw['pobox_mode'])) {
                    $out['pobox_mode'] = in_array($raw['pobox_mode'], ['warn', 'block'], true) ? $raw['pobox_mode'] : $current['pobox_mode'];
                }
                if (isset($raw['map_id'])) {
                    $out['map_id'] = self::mapId($raw['map_id']);
                }
                break;

            case 'optins':
                $out['optins'] = self::optins($raw['optins'] ?? [], is_array($current['optins'] ?? null) ? $current['optins'] : self::defaults()['optins']);
                break;
        }
        return $out;
    }

    /**
     * @param mixed $raw
     * @param array<string, mixed> $current
     * @return array<string, mixed>
     */
    private static function optins(mixed $raw, array $current): array
    {
        $raw = is_array($raw) ? $raw : [];
        $defaults = self::defaults()['optins'];
        $out = $current + $defaults;

        $webhook = is_array($raw['webhook'] ?? null) ? $raw['webhook'] : [];
        $w = is_array($out['webhook']) ? $out['webhook'] + $defaults['webhook'] : $defaults['webhook'];
        $w['url'] = array_key_exists('url', $webhook) ? self::webhookUrl($webhook['url']) : $w['url'];
        $w['consent'] = array_key_exists('consent', $webhook) ? self::flag($webhook['consent']) : $w['consent'];
        $w['include_address'] = array_key_exists('include_address', $webhook) ? self::flag($webhook['include_address']) : $w['include_address'];
        if (isset($webhook['events']) && is_array($webhook['events'])) {
            $w['events'] = array_values(array_intersect(['bad', 'check', 'pobox'], array_filter($webhook['events'], 'is_string')));
        }
        // Switched on only with a valid https address AND the consent tick; anything less leaves it off.
        $wantsOn = array_key_exists('enabled', $webhook) ? self::flag($webhook['enabled']) : (bool) $w['enabled'];
        $w['enabled'] = $wantsOn && $w['consent'] === true && $w['url'] !== '';
        $out['webhook'] = $w;

        $abandon = is_array($raw['abandonment'] ?? null) ? $raw['abandonment'] : [];
        $a = is_array($out['abandonment']) ? $out['abandonment'] : $defaults['abandonment'];
        $a['enabled'] = array_key_exists('enabled', $abandon) ? self::flag($abandon['enabled']) : (bool) ($a['enabled'] ?? false);
        $out['abandonment'] = $a;

        $ip = is_array($raw['ip'] ?? null) ? $raw['ip'] : [];
        $i = is_array($out['ip']) ? $out['ip'] + $defaults['ip'] : $defaults['ip'];
        $i['enabled'] = array_key_exists('enabled', $ip) ? self::flag($ip['enabled']) : (bool) $i['enabled'];
        if (isset($ip['source'])) {
            $i['source'] = in_array($ip['source'], ['header', 'service'], true) ? $ip['source'] : $i['source'];
        }
        if (array_key_exists('service_url', $ip)) {
            $i['service_url'] = self::ipServiceUrl($ip['service_url']);
        }
        // The external lookup is only usable with a valid https address; without one it falls back to the no-call header source.
        if ($i['source'] === 'service' && $i['service_url'] === '') {
            $i['source'] = 'header';
        }
        $out['ip'] = $i;

        return $out;
    }

    /** Which of the three opt-ins is really on (the single answer every other class must ask). */
    public static function optInEnabled(array $settings, string $name): bool
    {
        $block = $settings['optins'][$name] ?? null;
        if (!is_array($block) || ($block['enabled'] ?? false) !== true) {
            return false;
        }
        if ($name === 'webhook') {
            return ($block['consent'] ?? false) === true && self::webhookUrl($block['url'] ?? '') !== '';
        }
        return true;
    }

    /**
     * The settings as the rest of the plugin should read them: a key set as a constant in wp-config.php wins over the saved one. The
     * result is for reading only and is never saved back (the stored option stays what the owner typed on the screen).
     *
     * @param array<string, mixed> $settings
     * @return array<string, mixed>
     */
    public static function effective(array $settings, mixed $browserConstant, mixed $serverConstant): array
    {
        foreach (['browser_key' => $browserConstant, 'server_key' => $serverConstant] as $name => $constant) {
            if (is_string($constant) && self::apiKey($constant) !== '') {
                $settings[$name] = self::apiKey($constant);
            }
        }
        return $settings;
    }

    /** @param array<string, mixed> $settings */
    public static function markWizardDone(array $settings): array
    {
        $settings['wizard_done'] = true;
        return $settings;
    }

    /** Whether this visitor should be given the autocomplete at all. */
    public static function isActiveFor(array $settings, bool $isAdministrator): bool
    {
        if (trim((string) ($settings['browser_key'] ?? '')) === '') {
            return false;
        }
        return match ($settings['mode'] ?? self::MODE_OFF) {
            self::MODE_LIVE => true,
            self::MODE_PREVIEW => $isAdministrator,
            default => false,
        };
    }

    /** A Google API key: letters, digits, dash, underscore only (that is all Google issues); anything else keeps the old value. */
    public static function apiKey(string $value, string $fallback = ''): string
    {
        $value = trim($value);
        return preg_match('/^[A-Za-z0-9_\-]{20,120}$/', $value) === 1 ? $value : $fallback;
    }

    /** Last four characters, for showing "a key is saved" without printing it. */
    public static function maskKey(string $key): string
    {
        return $key === '' ? '' : str_repeat("\u{2022}", 8) . substr($key, -4);
    }

    /**
     * Up to five ISO 3166-1 alpha-2 codes, upper case, unique, from an array or a comma/space separated string.
     *
     * @return list<string>
     */
    public static function countries(mixed $value): array
    {
        if (is_string($value)) {
            $value = preg_split('/[\s,;]+/', $value) ?: [];
        }
        if (!is_array($value)) {
            return [];
        }
        $out = [];
        foreach ($value as $item) {
            if (!is_string($item)) {
                continue;
            }
            $code = strtoupper(trim($item));
            if (preg_match('/^[A-Z]{2}$/', $code) === 1 && !in_array($code, $out, true)) {
                $out[] = $code;
            }
            if (count($out) >= self::MAX_COUNTRIES) {
                break;
            }
        }
        return $out;
    }

    /** A BCP 47 style language tag (`en`, `en-GB`, `pt-BR`), or empty for "the page's own language". */
    public static function language(mixed $value): string
    {
        $value = is_string($value) ? trim($value) : '';
        return preg_match('/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/', $value) === 1 ? $value : '';
    }

    public static function intRange(mixed $value, int $min, int $max, int $fallback): int
    {
        if (is_int($value) || (is_string($value) && preg_match('/^-?\d{1,6}$/', trim($value)) === 1)) {
            return max($min, min($max, (int) $value));
        }
        return $fallback;
    }

    public static function flag(mixed $value): bool
    {
        return $value === true || $value === 1 || $value === '1' || $value === 'true' || $value === 'on';
    }

    /** Hex colors only (#rgb or #rrggbb): the value is printed into a style rule, so nothing else is allowed through. */
    public static function color(mixed $value, string $fallback): string
    {
        $value = is_string($value) ? trim($value) : '';
        return preg_match('/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/', $value) === 1 ? strtolower($value) : $fallback;
    }

    /** A Google Maps "Map ID" (letters, digits, dash, underscore). */
    public static function mapId(mixed $value): string
    {
        $value = is_string($value) ? trim($value) : '';
        return preg_match('/^[A-Za-z0-9_\-]{1,64}$/', $value) === 1 ? $value : 'DEMO_MAP_ID';
    }

    /** https only, no credentials in the address, a real host, at most 500 characters. Empty when invalid. */
    public static function webhookUrl(mixed $value): string
    {
        return self::httpsUrl($value);
    }

    public static function ipServiceUrl(mixed $value): string
    {
        $url = self::httpsUrl($value);
        // The visitor's address is substituted for {ip}; a service address without it is useless.
        return $url !== '' && str_contains($url, '{ip}') ? $url : '';
    }

    private static function httpsUrl(mixed $value): string
    {
        $value = is_string($value) ? trim($value) : '';
        if ($value === '' || strlen($value) > 500 || preg_match('/[\x00-\x20<>"\\\\^`{|}]/', str_replace('{ip}', '', $value)) === 1) {
            return '';
        }
        $parts = parse_url(str_replace('{ip}', '0.0.0.0', $value));
        if (!is_array($parts) || ($parts['scheme'] ?? '') !== 'https' || ($parts['host'] ?? '') === '' || isset($parts['user']) || isset($parts['pass'])) {
            return '';
        }
        return $value;
    }
}
