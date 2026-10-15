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

    /** @var list<array<string, mixed>> forms that matched this page */
    private array $pageForms = [];
    /** @var list<array<string, mixed>> forms made by [kcpw_address_autocomplete] shortcodes on this page */
    private array $shortcodeForms = [];
    private bool $queued = false;
    private bool $isAdmin = false;

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

    /** Whether this visitor is given the autocomplete at all (the same gates for forms and shortcodes). */
    public function allowed(): bool
    {
        if (Picker::active() || is_admin() || (function_exists('wp_doing_ajax') && wp_doing_ajax())) {
            return false;
        }
        $this->isAdmin = current_user_can('manage_options');
        return Settings::isActiveFor($this->settings, $this->isAdmin);
    }

    public function enqueue(): void
    {
        if (!$this->allowed()) {
            return;
        }
        $this->pageForms = PageMatcher::select($this->forms, $this->context());
        if ($this->pageForms !== []) {
            $this->queue();
        }
    }

    /** A shortcode on the page adds its own form (and, with it, the script). Already sanitized by the caller. */
    public function addShortcodeForm(array $form): void
    {
        $this->shortcodeForms[] = $form;
        $this->queue();
    }

    private function queue(): void
    {
        if ($this->queued) {
            return;
        }
        $this->queued = true;
        $base = plugin_dir_url($this->file);
        wp_enqueue_style(self::HANDLE, $base . 'assets/css/kcpw-aa.css', [], $this->version);
        wp_enqueue_script(self::HANDLE, $base . 'assets/js/kcpw-aa.js', [], $this->version, ['in_footer' => true, 'strategy' => 'defer']);
        // The configuration is printed just before the footer scripts, once every shortcode on the page has had its say.
        add_action('wp_footer', [$this, 'printConfig'], 1);
        // Late in the footer, note any other plugin that loads Google Maps on this page.
        add_action('wp_print_footer_scripts', [new Conflicts(), 'onFooter'], 99);
    }

    public function printConfig(): void
    {
        // JSON_HEX_* keep a "</script>" or an ampersand inside a value from ever ending the block or the attribute.
        $json = wp_json_encode($this->buildConfig(array_merge($this->pageForms, $this->shortcodeForms), $this->isAdmin), JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_UNESCAPED_SLASHES);
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
            'rest' => $this->restUrls($isAdmin),
            'poboxMode' => (string) ($s['pobox_mode'] ?? 'warn'),
            'mapId' => (string) ($s['map_id'] ?? 'DEMO_MAP_ID'),
            // Each opt-in is a plain yes/no here; the browser asks for nothing the owner has not switched on.
            'hint' => Settings::optInEnabled($s, 'ip'),
            'countCheckouts' => Settings::optInEnabled($s, 'abandonment') && function_exists('is_checkout') && is_checkout(),
            'i18n' => self::strings(),
            'forms' => array_map(fn (array $form): array => FormConfig::forBrowser($form, $s), $forms),
        ];
        return $config;
    }

    /**
     * Only the routes that exist are listed. The REST nonce is given to a signed-in administrator only: it is what lets the address
     * check and the other routes recognise them during Preview (a visitor without it is refused until the plugin is Live).
     *
     * @return array<string, string>
     */
    private function restUrls(bool $isAdmin): array
    {
        $urls = ['usage' => rest_url('kcpw-aa/v1/usage')];
        $modules = is_array($this->settings['modules'] ?? null) ? $this->settings['modules'] : [];
        if (($modules['validation'] ?? false) === true && trim((string) ($this->settings['server_key'] ?? '')) !== '') {
            $urls['validate'] = rest_url('kcpw-aa/v1/validate');
        }
        if (Settings::optInEnabled($this->settings, 'ip')) {
            $urls['hint'] = rest_url('kcpw-aa/v1/hint');
        }
        if (Settings::optInEnabled($this->settings, 'abandonment')) {
            $urls['start'] = rest_url('kcpw-aa/v1/checkout-start');
        }
        if ($isAdmin) {
            $urls['nonce'] = wp_create_nonce('wp_rest');
        }
        return $urls;
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
            // The address check cannot work without the server key, so without one its file is never even offered to the page.
            if ($id === 'validation' && trim((string) ($this->settings['server_key'] ?? '')) === '') {
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
            'tools' => __('Other ways to enter your address', 'kcpw-address-autocomplete'),
            'gps' => __('Use my location', 'kcpw-address-autocomplete'),
            'gpsWorking' => __('Finding your location…', 'kcpw-address-autocomplete'),
            'gpsDenied' => __('We could not get your location. You can type your address instead.', 'kcpw-address-autocomplete'),
            'gpsFailed' => __('We could not turn your location into an address. Please type it instead.', 'kcpw-address-autocomplete'),
            'map' => __('Choose on a map', 'kcpw-address-autocomplete'),
            'mapTitle' => __('Choose your address on the map', 'kcpw-address-autocomplete'),
            'mapHelp' => __('Click or tap the map, or drag the pin, to mark where you are. The buttons below move the pin one step. You can also close this window and type your address.', 'kcpw-address-autocomplete'),
            'mapLoading' => __('Loading the map…', 'kcpw-address-autocomplete'),
            'mapFailed' => __('The map could not be loaded. Please type your address instead.', 'kcpw-address-autocomplete'),
            /* translators: %s: an address */
            'mapNear' => __('Pin is near: %s', 'kcpw-address-autocomplete'),
            'mapNoAddress' => __('There is no address at the pin. Move it, or type your address.', 'kcpw-address-autocomplete'),
            'mapMove' => __('Move the pin', 'kcpw-address-autocomplete'),
            'mapUse' => __('Use this address', 'kcpw-address-autocomplete'),
            'mapClose' => __('Close the map', 'kcpw-address-autocomplete'),
            'mapNorth' => __('Move pin north', 'kcpw-address-autocomplete'),
            'mapSouth' => __('Move pin south', 'kcpw-address-autocomplete'),
            'mapEast' => __('Move pin east', 'kcpw-address-autocomplete'),
            'mapWest' => __('Move pin west', 'kcpw-address-autocomplete'),
            'poBoxWarn' => __('This looks like a PO box. Please check that we can deliver to it.', 'kcpw-address-autocomplete'),
            'poBoxBlock' => __('This looks like a PO box. We can only deliver to a street address.', 'kcpw-address-autocomplete'),
            'military' => __('This looks like a military (APO/FPO) address. Please check that we can deliver to it.', 'kcpw-address-autocomplete'),
            'checking' => __('Checking your address…', 'kcpw-address-autocomplete'),
            'checkOk' => __('This address looks right.', 'kcpw-address-autocomplete'),
            'checkMaybe' => __('Please double-check this address.', 'kcpw-address-autocomplete'),
            'checkBad' => __('We could not verify this address. Please check it.', 'kcpw-address-autocomplete'),
        ];
    }
}
