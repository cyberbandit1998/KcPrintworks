<?php
declare(strict_types=1);

namespace KcPrintworks\AddressAutocomplete;

/**
 * One "form" = where to offer suggestions and which fields to fill. Pure PHP; everything stored or imported goes through
 * {@see FormConfig::sanitize()} so the browser only ever receives values this class has already limited.
 */
final class FormConfig
{
    public const OPTION = 'kcpw_aa_forms';

    public const MAX_FORMS = 25;
    public const MAX_GROUPS = 6;
    public const MAX_SELECTOR_LENGTH = 300;
    public const PAGE_MODES = ['checkout', 'all', 'selected'];

    /** The per-form switches for the optional modules; each only counts when the module is also on in the global settings. */
    public const FEATURES = ['map_picker', 'gps', 'validation', 'pobox'];

    /** @return array<string, mixed> */
    public static function blank(string $preset = 'custom'): array
    {
        $presets = Presets::all();
        $p = $presets[$preset] ?? $presets['custom'];
        $id = self::newId();
        return [
            'id' => $id,
            'name' => $p['label'],
            'enabled' => true,
            'preset' => isset($presets[$preset]) ? $preset : 'custom',
            'mode' => 'smart',
            'groups' => array_map(static fn (array $group): array => $group + ['scope' => ''], $p['groups']),
            'pages' => $p['pages'],
            'countries' => [],
            'language' => '',
            'place_types' => '',
            'features' => array_fill_keys(self::FEATURES, true),
        ];
    }

    /**
     * @param mixed $raw
     * @return array<string, mixed>|null null when there is nothing usable (no groups with an address selector)
     */
    public static function sanitize(mixed $raw): ?array
    {
        if (!is_array($raw)) {
            return null;
        }
        $id = isset($raw['id']) && is_string($raw['id']) && preg_match('/^[a-z0-9_]{3,40}$/', $raw['id']) === 1 ? $raw['id'] : self::newId();
        $presets = Presets::all();

        $groups = [];
        foreach (is_array($raw['groups'] ?? null) ? $raw['groups'] : [] as $group) {
            $clean = self::sanitizeGroup($group);
            if ($clean !== null) {
                $groups[] = $clean;
            }
            if (count($groups) >= self::MAX_GROUPS) {
                break;
            }
        }
        if ($groups === []) {
            return null;
        }

        $pages = is_array($raw['pages'] ?? null) ? $raw['pages'] : [];
        $features = is_array($raw['features'] ?? null) ? $raw['features'] : [];
        $placeTypes = $raw['place_types'] ?? '';

        return [
            'id' => $id,
            'name' => self::text($raw['name'] ?? '', 80) ?: 'Address form',
            'enabled' => Settings::flag($raw['enabled'] ?? true),
            'preset' => isset($raw['preset'], $presets[$raw['preset']]) ? (string) $raw['preset'] : 'custom',
            'mode' => ($raw['mode'] ?? 'smart') === 'single' ? 'single' : 'smart',
            'groups' => $groups,
            'pages' => [
                'mode' => in_array($pages['mode'] ?? '', self::PAGE_MODES, true) ? $pages['mode'] : 'selected',
                'ids' => self::ids($pages['ids'] ?? []),
                'paths' => self::paths($pages['paths'] ?? []),
                'account_address' => Settings::flag($pages['account_address'] ?? false),
            ],
            'countries' => Settings::countries($raw['countries'] ?? []),
            'language' => Settings::language($raw['language'] ?? ''),
            'place_types' => in_array($placeTypes, Settings::PLACE_TYPES, true) ? $placeTypes : '',
            'features' => self::features($features),
        ];
    }

    /**
     * @param mixed $raw
     * @return list<array<string, mixed>>
     */
    public static function sanitizeList(mixed $raw): array
    {
        $out = [];
        $seen = [];
        foreach (is_array($raw) ? $raw : [] as $item) {
            $form = self::sanitize($item);
            if ($form === null) {
                continue;
            }
            while (isset($seen[$form['id']])) {
                $form['id'] = self::newId();
            }
            $seen[$form['id']] = true;
            $out[] = $form;
            if (count($out) >= self::MAX_FORMS) {
                break;
            }
        }
        return $out;
    }

    /**
     * The same form under a new id and a "copy" name (the "Duplicate" button).
     *
     * @param array<string, mixed> $form
     * @return array<string, mixed>
     */
    public static function duplicate(array $form): array
    {
        $copy = $form;
        $copy['id'] = self::newId();
        $copy['name'] = self::text(($form['name'] ?? 'Address form') . ' (copy)', 80);
        return $copy;
    }

    /**
     * Export: a JSON document with a format marker so an import can refuse anything else. Selectors and switches only, never a key.
     *
     * @param list<array<string, mixed>> $forms
     */
    public static function export(array $forms): string
    {
        return (string) json_encode(
            ['kcpw_address_autocomplete' => 1, 'forms' => array_values($forms)],
            JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE,
        );
    }

    /**
     * Import: accepts only a document this plugin wrote, re-sanitizes every form, and gives every form a fresh id so an import can
     * never overwrite an existing one.
     *
     * @return list<array<string, mixed>>|null null when the text is not a valid export
     */
    public static function import(string $json): ?array
    {
        if (strlen($json) > 400_000) {
            return null;
        }
        $data = json_decode($json, true);
        if (!is_array($data) || ($data['kcpw_address_autocomplete'] ?? null) !== 1 || !is_array($data['forms'] ?? null)) {
            return null;
        }
        $forms = self::sanitizeList($data['forms']);
        foreach ($forms as $i => $form) {
            $forms[$i]['id'] = self::newId();
        }
        return $forms;
    }

    /**
     * What the browser needs for one form, with the global defaults filled in. No key, no setting that is not used on the page.
     *
     * @param array<string, mixed> $form
     * @param array<string, mixed> $settings
     * @return array<string, mixed>
     */
    public static function forBrowser(array $form, array $settings): array
    {
        $modules = is_array($settings['modules'] ?? null) ? $settings['modules'] : [];
        $features = [];
        foreach (self::FEATURES as $name) {
            $features[$name] = ($modules[$name] ?? false) === true && ($form['features'][$name] ?? false) === true;
        }
        $groups = [];
        foreach ($form['groups'] as $group) {
            $groups[] = ['label' => (string) $group['label'], 'scope' => (string) ($group['scope'] ?? ''), 'fields' => $group['fields']];
        }
        return [
            'id' => $form['id'],
            'mode' => $form['mode'],
            'groups' => $groups,
            'countries' => $form['countries'] !== [] ? $form['countries'] : ($settings['countries'] ?? []),
            'language' => $form['language'] !== '' ? $form['language'] : ($settings['language'] ?? ''),
            'placeTypes' => $form['place_types'] !== '' ? $form['place_types'] : ($settings['place_types'] ?? 'address'),
            'features' => $features,
        ];
    }

    /** @return array{label: string, scope: string, fields: array<string, string>}|null */
    private static function sanitizeGroup(mixed $group): ?array
    {
        if (!is_array($group)) {
            return null;
        }
        $fields = [];
        foreach (Presets::FIELDS as $name) {
            $fields[$name] = self::selector($group['fields'][$name] ?? '');
        }
        // A group without the field the visitor types in has nothing to attach to.
        if ($fields['address'] === '') {
            return null;
        }
        return [
            'label' => self::text($group['label'] ?? '', 60) ?: 'Address',
            'scope' => self::selector($group['scope'] ?? ''),
            'fields' => $fields,
        ];
    }

    /**
     * A selector is only ever handed to document.querySelector in the visitor's browser, which cannot run code. It is still kept
     * short and free of `<` and control characters, because it is printed into the admin pages and into a JSON block (both escape it
     * again on output). `>` stays: it is the child combinator the "full path" choice of the Visual Selector Tool writes.
     */
    public static function selector(mixed $value): string
    {
        if (!is_string($value)) {
            return '';
        }
        $value = trim(str_replace(['<', "\u{2028}", "\u{2029}"], '', preg_replace('/[\x00-\x1f\x7f]+/', ' ', $value) ?? ''));
        return strlen($value) > self::MAX_SELECTOR_LENGTH ? '' : $value;
    }

    /** @return list<int> */
    private static function ids(mixed $value): array
    {
        $out = [];
        foreach (is_array($value) ? $value : [] as $item) {
            if (is_numeric($item) && (int) $item > 0 && !in_array((int) $item, $out, true)) {
                $out[] = (int) $item;
            }
            if (count($out) >= 50) {
                break;
            }
        }
        return $out;
    }

    /** @return list<string> */
    private static function paths(mixed $value): array
    {
        if (is_string($value)) {
            $value = preg_split('/\R+/', $value) ?: [];
        }
        $out = [];
        foreach (is_array($value) ? $value : [] as $item) {
            $path = is_string($item) ? trim($item) : '';
            if ($path !== '' && strlen($path) <= 200 && preg_match('#^/[A-Za-z0-9/_\-.%*]*$#', $path) === 1 && !in_array($path, $out, true)) {
                $out[] = $path;
            }
            if (count($out) >= 30) {
                break;
            }
        }
        return $out;
    }

    /** @return array<string, bool> */
    private static function features(array $value): array
    {
        $out = [];
        foreach (self::FEATURES as $name) {
            $out[$name] = Settings::flag($value[$name] ?? true);
        }
        return $out;
    }

    private static function text(mixed $value, int $max): string
    {
        $value = is_string($value) ? trim(preg_replace('/[\x00-\x1f\x7f]+/', ' ', strip_tags($value)) ?? '') : '';
        return mb_substr($value, 0, $max);
    }

    public static function newId(): string
    {
        return 'f_' . bin2hex(random_bytes(4));
    }
}
