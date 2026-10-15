<?php
declare(strict_types=1);

namespace KcPrintworks\AddressAutocomplete;

/**
 * Notices other plugins that load Google Maps on the same pages. Two copies of Google's script on one page can stop either from
 * working, and the usual cause of "suggestions do not appear" on a busy site is exactly that.
 *
 * It records only the script's handle and HOST (never the address, which may carry that other plugin's own key), and only on pages
 * where this plugin is active. The result is kept for a day and shown on the Dashboard.
 */
final class Conflicts
{
    public const TRANSIENT = 'kcpw_aa_conflicts';
    private const HOSTS = ['maps.googleapis.com', 'maps.google.com'];

    /**
     * @param array<string, string> $scripts handle => source address of every script printed on the page
     * @return list<array{handle: string, host: string}>
     */
    public static function detect(array $scripts): array
    {
        $found = [];
        foreach ($scripts as $handle => $src) {
            $handle = (string) $handle;
            if ($handle === '' || str_starts_with($handle, 'kcpw-aa') || !is_string($src)) {
                continue;
            }
            $host = parse_url(str_starts_with($src, '//') ? 'https:' . $src : $src, PHP_URL_HOST);
            if (is_string($host) && in_array(strtolower($host), self::HOSTS, true)) {
                $found[] = ['handle' => substr(preg_replace('/[^A-Za-z0-9_\-.]/', '', $handle) ?? '', 0, 80), 'host' => strtolower($host)];
            }
        }
        return array_slice($found, 0, 10);
    }

    /** Reads the scripts WordPress has just printed (called late in the footer). */
    public function onFooter(): void
    {
        global $wp_scripts;
        if (!is_object($wp_scripts) || !isset($wp_scripts->done, $wp_scripts->registered) || !is_array($wp_scripts->done)) {
            return;
        }
        $scripts = [];
        foreach ($wp_scripts->done as $handle) {
            $registered = $wp_scripts->registered[$handle] ?? null;
            if (is_object($registered) && isset($registered->src) && is_string($registered->src)) {
                $scripts[(string) $handle] = $registered->src;
            }
        }
        $found = self::detect($scripts);
        if ($found !== self::stored()) {
            set_transient(self::TRANSIENT, $found, DAY_IN_SECONDS);
        }
    }

    /** @return list<array{handle: string, host: string}> */
    public static function stored(): array
    {
        $value = get_transient(self::TRANSIENT);
        if (!is_array($value)) {
            return [];
        }
        $out = [];
        foreach ($value as $item) {
            if (is_array($item) && isset($item['handle'], $item['host']) && is_string($item['handle']) && is_string($item['host'])) {
                $out[] = ['handle' => $item['handle'], 'host' => $item['host']];
            }
        }
        return $out;
    }
}
