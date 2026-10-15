<?php
declare(strict_types=1);

namespace KcPrintworks\AddressAutocomplete;

/**
 * What a visitor's page gets: nothing at all unless every gate is open, then ONE small script, ONE small stylesheet and a JSON block.
 *
 * Gates, in order: the plugin is not Off; a browser key is saved; Preview mode shows it to administrators only; the page matches at
 * least one enabled form (so the cart, shop and blog pages never load a byte of it). The Google script is not loaded here: the
 * plugin's own script asks for it the first time a visitor focuses an address field.
 */
final class Frontend
{
    public const HANDLE = 'kcpw-aa';

    /** Optional module files, loaded by the core script only when the module is on AND the form uses it. */
    public const MODULE_FILES = [
        'map_picker' => 'kcpw-aa-map.js',
        'gps' => 'kcpw-aa-gps.js',
        'validation' => 'kcpw-aa-validate.js',
        'pobox' => 'kcpw-aa-pobox.js',
    ];

    /**
     * @param array<string, mixed> $settings
     * @param list<array<string, mixed>> $forms
     */
    public function __construct(
        private readonly string $file,
        private readonly string $version,
        private readonly array $settings,
        private readonly array $forms,
    ) {
    }

    public function register(): void
    {
        add_action('wp_enqueue_scripts', [$this, 'enqueue']);
    }

    public function enqueue(): void
    {
        if (is_admin() || (function_exists('wp_doing_ajax') && wp_doing_ajax())) {
            return;
        }
        $isAdmin = current_user_can('manage_options');
        if (!Settings::isActiveFor($this->settings, $isAdmin)) {
            return;
        }
        $forms = PageMatcher::select($this->forms, $this->context());
        if ($forms === []) {
            return;
        }

        $base = plugin_dir_url($this->file);
        wp_enqueue_style(self::HANDLE, $base . 'assets/css/kcpw-aa.css', [], $this->version);
        wp_enqueue_script(self::HANDLE, $base . 'assets/js/kcpw-aa.js', [], $this->version, ['in_footer' => true, 'strategy' => 'defer']);
        // JSON_HEX_* keep a "</script>" or an ampersand inside a value from ever ending the block or the attribute.
        $json = wp_json_encode($this->buildConfig($forms, $isAdmin), JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_UNESCAPED_SLASHES);
        wp_add_inline_script(self::HANDLE, 'window.KCPW_AA=' . $json . ';', 'before');
    }

    /**
     * Where this request is, in the words PageMatcher understands.
     *
     * @return array<string, mixed>
     */
    public function context(): array
    {
        $uri = isset($_SERVER['REQUEST_URI']) ? (string) wp_unslash($_SERVER['REQUEST_URI']) : '';
        $path = (string) (wp_parse_url($uri, PHP_URL_PATH) ?? '');
        $home = (string) (wp_parse_url(home_url(), PHP_URL_PATH) ?? '');
        if ($home !== '' && $home !== '/' && str_starts_with($path, $home)) {
            $path = substr($path, strlen($home));
        }
        return [
            'postId' => (int) get_queried_object_id(),
            'isCheckout' => function_exists('is_checkout') && is_checkout(),
            'isOrderReceived' => function_exists('is_order_received_page') && is_order_received_page(),
            'isAccountAddress' => function_exists('is_account_page') && function_exists('is_wc_endpoint_url') && is_account_page() && is_wc_endpoint_url('edit-address'),
            'path' => $path,
        ];
    }

    /**
     * The JSON the script reads. It holds the PUBLIC browser key (Google keys for the browser are public by design: restrict them to
     * your site in Google Cloud), selectors, switches and sentences. It never holds the server key, a nonce, a user or an address.
     *
     * @param list<array<string, mixed>> $forms
     * @return array<string, mixed>
     */
    public function buildConfig(array $forms, bool $isAdmin): array
    {
        $s = $this->settings;
        $language = (string) ($s['language'] ?? '');
        if ($language === '') {
            $language = Settings::language(str_replace('_', '-', (string) determine_locale())) ?: Settings::language(substr((string) determine_locale(), 0, 2));
        }
        $config = [
            'v' => $this->version,
            'key' => (string) $s['browser_key'],
            'mapsVersion' => 'weekly',
            'language' => $language,
            'admin' => $isAdmin,
            'preview' => ($s['mode'] ?? '') === Settings::MODE_PREVIEW,
            'minChars' => (int) $s['min_chars'],
            'debounce' => (int) $s['debounce_ms'],
            'maxRequests' => (int) $s['max_requests'],
            'disableAutofill' => (bool) $s['disable_autofill'],
            'fallbackNotice' => (bool) $s['show_fallback_notice'],
            'usage' => (bool) $s['usage_counters'],
            'style' => ['theme' => (string) $s['theme'], 'accent' => (string) $s['accent'], 'radius' => (int) $s['radius']],
            'modules' => $this->moduleUrls($forms),
            'rest' => ['usage' => rest_url('kcpw-aa/v1/usage')],
            'i18n' => self::strings(),
            'forms' => array_map(fn (array $form): array => FormConfig::forBrowser($form, $s), $forms),
        ];
        return $config;
    }

    /**
     * Only modules that are on globally AND used by a form on this page get a URL, so a page that needs none loads none.
     *
     * @param list<array<string, mixed>> $forms
     * @return array<string, string>
     */
    public function moduleUrls(array $forms): array
    {
        $modules = is_array($this->settings['modules'] ?? null) ? $this->settings['modules'] : [];
        $dir = plugin_dir_path($this->file) . 'assets/js/';
        $base = plugin_dir_url($this->file) . 'assets/js/';
        $urls = [];
        foreach (self::MODULE_FILES as $id => $file) {
            if (($modules[$id] ?? false) !== true || !is_file($dir . $file)) {
                continue;
            }
            foreach ($forms as $form) {
                if (($form['features'][$id] ?? false) === true) {
                    $urls[$id] = $base . $file . '?ver=' . rawurlencode($this->version);
                    break;
                }
            }
        }
        return $urls;
    }

    /** @return array<string, string> */
    public static function strings(): array
    {
        return [
            'attribution' => __('Powered by Google', 'kcpw-address-autocomplete'),
            'listLabel' => __('Address suggestions', 'kcpw-address-autocomplete'),
            /* translators: %d: number of suggestions */
            'count' => __('%d address suggestions available. Use the up and down arrow keys, then Enter to choose.', 'kcpw-address-autocomplete'),
            'noResults' => __('No suggestions. Keep typing, or enter your address yourself.', 'kcpw-address-autocomplete'),
            'unavailable' => __('Address suggestions are not available right now. Please enter your address yourself.', 'kcpw-address-autocomplete'),
            'limit' => __('Suggestions paused. Please finish typing your address yourself.', 'kcpw-address-autocomplete'),
            'loading' => __('Looking up addresses…', 'kcpw-address-autocomplete'),
            'placeFailed' => __('We could not load that address. Please finish it yourself.', 'kcpw-address-autocomplete'),
            'filled' => __('Address filled in. Please check each field.', 'kcpw-address-autocomplete'),
            'unit' => __('Unit', 'kcpw-address-autocomplete'),
            'preview' => __('Address suggestions: preview for administrators only. Customers do not see them yet.', 'kcpw-address-autocomplete'),
            'previewDismiss' => __('Dismiss this notice', 'kcpw-address-autocomplete'),
            'problem' => __('Address suggestions are not working on this page', 'kcpw-address-autocomplete'),
        ];
    }
}
