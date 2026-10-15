<?php
declare(strict_types=1);

namespace KcPrintworks\AddressAutocomplete;

/**
 * The administrator screens that are not about forms: Dashboard (status, key test, Google setup, usage, conflicts), the setup wizard
 * page and Settings. Forms live in {@see AdminForms}.
 *
 * Every screen needs the `manage_options` capability, every change is a POST to admin-post.php with a nonce for exactly that action,
 * and every saved value goes through {@see Settings} or {@see FormConfig} first. A saved API key is never printed back into a page:
 * only its last four characters are shown. Each screen is built by a method that RETURNS HTML (escaped where the data goes in), so
 * the markup is tested without WordPress.
 */
class Admin
{
    public const CAPABILITY = 'manage_options';
    public const SLUG = 'kcpw-aa';

    public function __construct(
        private readonly string $file,
        private readonly string $version,
        private readonly Store $store,
    ) {
    }

    public function register(): void
    {
        add_action('admin_menu', [$this, 'menu']);
        add_action('admin_enqueue_scripts', [$this, 'assets']);
        add_action('admin_post_kcpw_aa_save', [$this, 'onSave']);
        add_action('admin_post_kcpw_aa_wizard', [$this, 'onWizard']);
    }

    public function menu(): void
    {
        $label = __('Address Autocomplete', 'kcpw-address-autocomplete');
        add_menu_page($label, $label, self::CAPABILITY, self::SLUG, [$this, 'renderDashboard'], 'dashicons-location', 58);
        add_submenu_page(self::SLUG, $label, __('Dashboard', 'kcpw-address-autocomplete'), self::CAPABILITY, self::SLUG, [$this, 'renderDashboard']);
        add_submenu_page(self::SLUG, $label, __('Forms', 'kcpw-address-autocomplete'), self::CAPABILITY, self::SLUG . '-forms', [$this, 'renderForms']);
        add_submenu_page(self::SLUG, $label, __('Settings', 'kcpw-address-autocomplete'), self::CAPABILITY, self::SLUG . '-settings', [$this, 'renderSettings']);
    }

    public function assets(string $hook): void
    {
        if (!str_contains($hook, self::SLUG)) {
            return;
        }
        $base = plugin_dir_url($this->file);
        wp_enqueue_style('kcpw-aa-admin', $base . 'assets/css/kcpw-aa-admin.css', [], $this->version);
        // The core script is loaded WITHOUT starting (KCPW_AA_MANUAL) so the key test can reuse its loader and error sorting.
        wp_enqueue_script('kcpw-aa-core', $base . 'assets/js/kcpw-aa.js', [], $this->version, ['in_footer' => true]);
        wp_add_inline_script('kcpw-aa-core', 'window.KCPW_AA_MANUAL=true;', 'before');
        wp_enqueue_script('kcpw-aa-admin', $base . 'assets/js/kcpw-aa-admin.js', ['kcpw-aa-core'], $this->version, ['in_footer' => true]);
        $data = [
            'key' => (string) $this->store->effective()['browser_key'],
            'language' => (string) $this->store->settings['language'],
            'i18n' => self::adminStrings() + Picker::adminStrings(),
        ];
        // The Visual Selector Tool's address list and one-time token exist only on the screen that edits a form.
        if (str_ends_with($hook, self::SLUG . '-forms')) {
            $data['picker'] = Picker::adminData();
        }
        $json = wp_json_encode($data, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_UNESCAPED_SLASHES);
        wp_add_inline_script('kcpw-aa-admin', 'window.KCPW_AA_ADMIN=' . $json . ';', 'before');
    }

    // ------------------------------------------------------------------------------------------------------------------
    // Screens
    // ------------------------------------------------------------------------------------------------------------------

    public function renderDashboard(): void
    {
        $this->guard();
        $view = isset($_GET['view']) ? sanitize_key((string) wp_unslash($_GET['view'])) : '';
        $step = isset($_GET['step']) ? (int) $_GET['step'] : 1;
        echo $view === 'wizard' ? (new Wizard($this->store))->html($step) : $this->dashboardHtml(); // phpcs:ignore WordPress.Security.EscapeOutput -- built from escaped parts
    }

    public function renderSettings(): void
    {
        $this->guard();
        $tab = isset($_GET['tab']) ? sanitize_key((string) wp_unslash($_GET['tab'])) : 'general';
        echo $this->settingsHtml($tab); // phpcs:ignore WordPress.Security.EscapeOutput
    }

    public function renderForms(): void
    {
        $this->guard();
        echo (new AdminForms($this->store))->screenHtml(); // phpcs:ignore WordPress.Security.EscapeOutput
    }

    public function dashboardHtml(): string
    {
        $s = $this->store->settings;
        $mode = (string) $s['mode'];
        $hasKey = (string) $this->store->effective()['browser_key'] !== '';
        $hasWoo = false;
        foreach ($this->store->forms as $form) {
            if (in_array($form['preset'] ?? '', ['woo_block', 'woo_classic'], true) && ($form['enabled'] ?? false) === true) {
                $hasWoo = true;
            }
        }
        $modeText = [
            Settings::MODE_OFF => __('Nothing is loaded for anyone.', 'kcpw-address-autocomplete'),
            Settings::MODE_PREVIEW => __('Only logged-in administrators get address suggestions. Customers see your checkout exactly as before.', 'kcpw-address-autocomplete'),
            Settings::MODE_LIVE => __('Every visitor gets address suggestions on the pages you chose.', 'kcpw-address-autocomplete'),
        ];

        $out = '<div class="wrap kcpw-aa-admin"><h1>' . Html::h(__('Address Autocomplete', 'kcpw-address-autocomplete')) . '</h1>' . Html::notice();

        // 1. Status and the safe order of switching on.
        $out .= '<section class="kcpw-aa-card" aria-labelledby="kcpw-aa-h-status"><h2 id="kcpw-aa-h-status">' . Html::h(__('Where things stand', 'kcpw-address-autocomplete')) . '</h2>';
        $out .= '<p class="kcpw-aa-mode" data-mode="' . Html::a($mode) . '"><strong>' . Html::h(self::modeName($mode)) . '.</strong> ' . Html::h($modeText[$mode] ?? '') . '</p>';
        $out .= '<ol class="kcpw-aa-steps">';
        $out .= self::step($hasKey, __('Save your Google browser key', 'kcpw-address-autocomplete'), $hasKey ? __('A key is saved.', 'kcpw-address-autocomplete') : __('Settings > General.', 'kcpw-address-autocomplete'));
        $out .= self::step($hasWoo, __('Add the WooCommerce checkout', 'kcpw-address-autocomplete'), $hasWoo ? __('The checkout form is set up.', 'kcpw-address-autocomplete') : __('Press the button below.', 'kcpw-address-autocomplete'));
        $out .= self::step($mode !== Settings::MODE_OFF, __('Test it as an administrator in Preview mode', 'kcpw-address-autocomplete'), __('Open your checkout while logged in. Customers do not see it yet.', 'kcpw-address-autocomplete'));
        $out .= self::step($mode === Settings::MODE_LIVE, __('Switch to Live when you are happy', 'kcpw-address-autocomplete'), __('Only then do customers get suggestions.', 'kcpw-address-autocomplete'));
        $out .= '</ol>';

        $out .= '<div class="kcpw-aa-actions">';
        if (($s['wizard_done'] ?? false) !== true) {
            $out .= '<a class="button button-primary" href="' . Html::a(admin_url('admin.php?page=' . self::SLUG . '&view=wizard')) . '">' . Html::h(__('Run the 3-step setup', 'kcpw-address-autocomplete')) . '</a>';
        }
        if (!$hasWoo) {
            $out .= Html::postForm('kcpw_aa_forms', 'kcpw_aa_forms', ['do' => 'add_preset', 'preset' => 'woo_block'], __('Add the WooCommerce checkout (block)', 'kcpw-address-autocomplete'), 'button');
        }
        foreach ([Settings::MODE_OFF => __('Turn off', 'kcpw-address-autocomplete'), Settings::MODE_PREVIEW => __('Preview (administrators only)', 'kcpw-address-autocomplete'), Settings::MODE_LIVE => __('Go live for customers', 'kcpw-address-autocomplete')] as $value => $text) {
            if ($value !== $mode) {
                $confirm = $value === Settings::MODE_LIVE ? 'data-confirm="' . Html::a(__('Customers will see address suggestions on your checkout right away. Continue?', 'kcpw-address-autocomplete')) . '"' : '';
                $out .= Html::postForm('kcpw_aa_save', 'kcpw_aa_save_general', ['section' => 'general', 's[mode]' => $value, 'return' => 'dashboard'], $text, 'button', $confirm);
            }
        }
        $out .= '</div></section>';

        // 2. Key test.
        $out .= '<section class="kcpw-aa-card" aria-labelledby="kcpw-aa-h-test"><h2 id="kcpw-aa-h-test">' . Html::h(__('Test your Google key', 'kcpw-address-autocomplete')) . '</h2>';
        $out .= '<p>' . Html::h(__('Loads Google in this browser with your saved browser key and tries each service the plugin uses. Nothing is changed and no customer is involved. A few test requests are billed to your Google project like any other.', 'kcpw-address-autocomplete')) . '</p>';
        $out .= '<p><button type="button" class="button" id="kcpw-aa-test"' . ($hasKey ? '' : ' disabled aria-disabled="true"') . '>' . Html::h(__('Test my key', 'kcpw-address-autocomplete')) . '</button></p>';
        $out .= '<ul id="kcpw-aa-test-results" class="kcpw-aa-results" aria-live="polite"></ul></section>';

        // 3. Conflicts, usage, Google requirements.
        $out .= $this->conflictsHtml();
        $out .= $this->usageHtml();
        $out .= $this->googleSetupHtml();

        return $out . '</div>';
    }

    public function conflictsHtml(): string
    {
        $found = Conflicts::stored();
        if ($found === []) {
            return '';
        }
        $out = '<section class="kcpw-aa-card kcpw-aa-conflicts" aria-labelledby="kcpw-aa-h-conflict"><h2 id="kcpw-aa-h-conflict">' . Html::h(__('Another plugin loads Google Maps', 'kcpw-address-autocomplete')) . '</h2>';
        $out .= '<p>' . Html::h(__('These scripts load Google Maps on pages where this plugin runs. Two copies of Google Maps on one page can stop address suggestions from working. If suggestions fail, ask the other plugin to use the current Google Maps script or switch its map off on these pages.', 'kcpw-address-autocomplete')) . '</p><ul>';
        foreach ($found as $item) {
            $out .= '<li><code>' . Html::h($item['handle']) . '</code> <span class="description">' . Html::h($item['host']) . '</span></li>';
        }
        return $out . '</ul></section>';
    }

    public function usageHtml(): string
    {
        $stored = get_option(Usage::OPTION, []);
        $summary = Usage::summary($stored, 30, gmdate('Y-m-d'));
        $t = $summary['totals'];
        $out = '<section class="kcpw-aa-card" aria-labelledby="kcpw-aa-h-usage"><h2 id="kcpw-aa-h-usage">' . Html::h(__('API usage (last 30 days, estimated)', 'kcpw-address-autocomplete')) . '</h2>';
        if (($this->store->settings['usage_counters'] ?? true) !== true) {
            return $out . '<p>' . Html::h(__('Usage counters are switched off (Settings > Behavior).', 'kcpw-address-autocomplete')) . '</p></section>';
        }
        $out .= '<p>' . Html::h(__('Counted from your visitors\' browsers: whole numbers only, never an address or what anyone typed. Google\'s own report is the authority for your bill.', 'kcpw-address-autocomplete')) . '</p>';
        $out .= '<table class="widefat striped kcpw-aa-usage"><tbody>';
        $rows = [
            __('Suggestion requests (Autocomplete)', 'kcpw-address-autocomplete') => $t['requests'],
            __('Address lookups after a choice (Place Details)', 'kcpw-address-autocomplete') => $t['details'],
            __('Suggestions chosen (completed sessions)', 'kcpw-address-autocomplete') => $t['selections'],
            __('Customers who typed the address themselves after a failure', 'kcpw-address-autocomplete') => $t['manual'],
        ];
        foreach ($rows as $label => $value) {
            $out .= '<tr><th scope="row">' . Html::h($label) . '</th><td>' . Html::h(number_format_i18n((int) $value)) . '</td></tr>';
        }
        $out .= '</tbody></table>';
        if ($summary['errors'] !== []) {
            $parts = [];
            foreach ($summary['errors'] as $code => $n) {
                $parts[] = Html::h($code . ': ' . $n);
            }
            $out .= '<p>' . Html::h(__('Problems seen:', 'kcpw-address-autocomplete')) . ' ' . implode(', ', $parts) . '. ' . Html::h(__('Run "Test my key" above.', 'kcpw-address-autocomplete')) . '</p>';
        }
        $out .= '<p><a href="https://console.cloud.google.com/google/maps-apis/metrics" target="_blank" rel="noopener noreferrer">' . Html::h(__('Open Google\'s usage report', 'kcpw-address-autocomplete')) . '</a></p>';
        return $out . '</section>';
    }

    public function googleSetupHtml(): string
    {
        $link = static fn (string $url, string $text): string => '<a href="' . Html::a($url) . '" target="_blank" rel="noopener noreferrer">' . Html::h($text) . '</a>';
        $out = '<section class="kcpw-aa-card" aria-labelledby="kcpw-aa-h-google"><h2 id="kcpw-aa-h-google">' . Html::h(__('Google setup: APIs, key and billing', 'kcpw-address-autocomplete')) . '</h2>';
        $out .= '<ol class="kcpw-aa-setup">';
        $out .= '<li><strong>' . Html::h(__('A Google Cloud project with billing turned on.', 'kcpw-address-autocomplete')) . '</strong> ' . Html::h(__('Google Maps Platform requires a billing account even when your use stays inside its free monthly allowance. The allowance and prices change: read the current ones before you go live.', 'kcpw-address-autocomplete')) . ' ' . $link('https://mapsplatform.google.com/pricing/', __('Google Maps Platform pricing', 'kcpw-address-autocomplete')) . '</li>';
        $out .= '<li><strong>' . Html::h(__('Turn on these APIs', 'kcpw-address-autocomplete')) . '</strong> (' . $link('https://console.cloud.google.com/apis/library', __('API Library', 'kcpw-address-autocomplete')) . '): <em>Maps JavaScript API</em> and <em>Places API (New)</em> ' . Html::h(__('are required.', 'kcpw-address-autocomplete')) . ' <em>Geocoding API</em> ' . Html::h(__('is only needed for the optional map picker and "use my location". "Address Validation API" is only needed for the optional address check.', 'kcpw-address-autocomplete')) . '</li>';
        $out .= '<li><strong>' . Html::h(__('Create a browser key', 'kcpw-address-autocomplete')) . '</strong> (' . $link('https://console.cloud.google.com/apis/credentials', __('Credentials', 'kcpw-address-autocomplete')) . '). ' . Html::h(__('Under "Application restrictions" choose "Websites" and add your shop address, for example https://shop.kcprintworks.com/*. Under "API restrictions" allow only the APIs above. A browser key is visible to visitors by design; the restrictions are what keep others from using it.', 'kcpw-address-autocomplete')) . '</li>';
        $out .= '<li><strong>' . Html::h(__('Set a spending limit', 'kcpw-address-autocomplete')) . '</strong> ' . Html::h(__('In Google Cloud, set a budget alert and a daily quota for the Places API. That is the only limit nobody can bypass; the plugin\'s own pause after a number of requests is a courtesy.', 'kcpw-address-autocomplete')) . '</li>';
        $out .= '</ol>';
        $out .= '<p><strong>' . Html::h(__('How the plugin keeps the cost down:', 'kcpw-address-autocomplete')) . '</strong> ' . Html::h(__('Google is contacted only when a visitor first clicks into an address field, never when a page loads. Requests wait for a pause in typing and for at least a few characters. One session token covers a whole typing session. Repeated text is answered from memory. After a choice it asks only for the address parts. After a failure it stops asking on that page.', 'kcpw-address-autocomplete')) . '</p>';
        $out .= '<p><strong>' . Html::h(__('Google\'s terms:', 'kcpw-address-autocomplete')) . '</strong> ' . Html::h(__('The list shows "Powered by Google" next to the suggestions. Keep it: Google\'s terms require it when suggestions are not shown on a Google map, and there is deliberately no setting to hide it.', 'kcpw-address-autocomplete')) . ' ' . $link('https://cloud.google.com/maps-platform/terms', __('Google Maps Platform terms', 'kcpw-address-autocomplete')) . '</p>';
        return $out . '</section>';
    }

    /** @param string $tab general|behavior|style */
    public function settingsHtml(string $tab): string
    {
        $tabs = [
            'general' => __('General', 'kcpw-address-autocomplete'),
            'behavior' => __('Behavior', 'kcpw-address-autocomplete'),
            'style' => __('Appearance', 'kcpw-address-autocomplete'),
        ];
        if (!isset($tabs[$tab])) {
            $tab = 'general';
        }
        $out = '<div class="wrap kcpw-aa-admin"><h1>' . Html::h(__('Address Autocomplete settings', 'kcpw-address-autocomplete')) . '</h1>' . Html::notice();
        $out .= '<nav class="nav-tab-wrapper" aria-label="' . Html::a(__('Settings sections', 'kcpw-address-autocomplete')) . '">';
        foreach ($tabs as $key => $label) {
            $out .= '<a class="nav-tab' . ($key === $tab ? ' nav-tab-active' : '') . '" href="' . Html::a(admin_url('admin.php?page=' . self::SLUG . '-settings&tab=' . $key)) . '"' . ($key === $tab ? ' aria-current="page"' : '') . '>' . Html::h($label) . '</a>';
        }
        $out .= '</nav>';
        $out .= '<form method="post" action="' . Html::a(admin_url('admin-post.php')) . '">';
        $out .= '<input type="hidden" name="action" value="kcpw_aa_save"><input type="hidden" name="section" value="' . Html::a($tab) . '">';
        $out .= wp_nonce_field('kcpw_aa_save_' . $tab, '_wpnonce', true, false);
        $out .= '<table class="form-table" role="presentation"><tbody>';
        $out .= match ($tab) {
            'behavior' => $this->behaviorRows(),
            'style' => $this->styleRows(),
            default => $this->generalRows(),
        };
        $out .= '</tbody></table><p class="submit"><button type="submit" class="button button-primary">' . Html::h(__('Save changes', 'kcpw-address-autocomplete')) . '</button></p></form></div>';
        return $out;
    }

    private function generalRows(): string
    {
        $s = $this->store->settings;
        $out = Html::row(__('Mode', 'kcpw-address-autocomplete'), Html::radios('s[mode]', (string) $s['mode'], [
            Settings::MODE_OFF => __('Off: load nothing', 'kcpw-address-autocomplete'),
            Settings::MODE_PREVIEW => __('Preview: administrators only (safe for testing)', 'kcpw-address-autocomplete'),
            Settings::MODE_LIVE => __('Live: all visitors', 'kcpw-address-autocomplete'),
        ], __('Mode', 'kcpw-address-autocomplete')), __('Start in Preview. Customers never see suggestions until you choose Live.', 'kcpw-address-autocomplete'));
        $out .= Html::row(__('Google browser key', 'kcpw-address-autocomplete'), $this->keyField('browser_key', 'kcpw-aa-browser-key'), __('Used in visitors\' browsers. Restrict it to your website and to the Maps JavaScript and Places (New) APIs in Google Cloud. You can also set KCPW_AA_BROWSER_KEY in wp-config.php.', 'kcpw-address-autocomplete'), 'kcpw-aa-browser-key');
        $out .= Html::row(__('Countries', 'kcpw-address-autocomplete'), Html::text('s[countries]', 'kcpw-aa-countries', implode(', ', $s['countries']), 'regular-text', 'maxlength="40" placeholder="US, CA"'), __('Up to five two-letter country codes, separated by commas. Leave empty to suggest addresses everywhere.', 'kcpw-address-autocomplete'), 'kcpw-aa-countries');
        $out .= Html::row(__('Language', 'kcpw-address-autocomplete'), Html::text('s[language]', 'kcpw-aa-language', (string) $s['language'], 'small-text', 'maxlength="8" placeholder="en"'), __('A language code such as en or pt-BR. Empty means your site\'s language.', 'kcpw-address-autocomplete'), 'kcpw-aa-language');
        return $out;
    }

    private function behaviorRows(): string
    {
        $s = $this->store->settings;
        $out = Html::row(__('Start suggesting after', 'kcpw-address-autocomplete'), Html::number('s[min_chars]', 'kcpw-aa-min', (int) $s['min_chars'], 2, 6) . ' ' . Html::h(__('characters', 'kcpw-address-autocomplete')), __('More characters means fewer, better requests.', 'kcpw-address-autocomplete'), 'kcpw-aa-min');
        $out .= Html::row(__('Wait after typing', 'kcpw-address-autocomplete'), Html::number('s[debounce_ms]', 'kcpw-aa-debounce', (int) $s['debounce_ms'], 200, 1000, 50) . ' ms', __('A pause in typing before Google is asked. 300 is a good balance.', 'kcpw-address-autocomplete'), 'kcpw-aa-debounce');
        $out .= Html::row(__('Pause suggestions after', 'kcpw-address-autocomplete'), Html::number('s[max_requests]', 'kcpw-aa-max', (int) $s['max_requests'], 3, 40) . ' ' . Html::h(__('requests in one typing session', 'kcpw-address-autocomplete')), __('A safety net against runaway cost. The customer can still type the address.', 'kcpw-address-autocomplete'), 'kcpw-aa-max');
        $out .= Html::row(__('What to suggest', 'kcpw-address-autocomplete'), Html::select('s[place_types]', 'kcpw-aa-types', (string) $s['place_types'], [
            'address' => __('Street addresses', 'kcpw-address-autocomplete'),
            'all' => __('Everything Google knows (addresses, places, businesses)', 'kcpw-address-autocomplete'),
            'cities' => __('Cities only', 'kcpw-address-autocomplete'),
            'regions' => __('Regions only (states, countries, postal codes)', 'kcpw-address-autocomplete'),
            'business' => __('Businesses', 'kcpw-address-autocomplete'),
        ]), __('If a real address is missing from the suggestions, try "Everything".', 'kcpw-address-autocomplete'), 'kcpw-aa-types');
        $out .= Html::row(__('Browser autofill', 'kcpw-address-autocomplete'), Html::checkbox('s[disable_autofill]', 'kcpw-aa-autofill', (bool) $s['disable_autofill'], __('Ask the browser not to show its own address list over ours', 'kcpw-address-autocomplete')));
        $out .= Html::row(__('When suggestions fail', 'kcpw-address-autocomplete'), Html::checkbox('s[show_fallback_notice]', 'kcpw-aa-notice', (bool) $s['show_fallback_notice'], __('Tell the customer once, in plain words, that they can type the address themselves', 'kcpw-address-autocomplete')), __('The address fields always keep working, with or without this message.', 'kcpw-address-autocomplete'));
        $out .= Html::row(__('Usage counters', 'kcpw-address-autocomplete'), Html::checkbox('s[usage_counters]', 'kcpw-aa-usage', (bool) $s['usage_counters'], __('Count requests, choices and failures (whole numbers only, never addresses)', 'kcpw-address-autocomplete')), __('Feeds the "API usage" panel on the Dashboard.', 'kcpw-address-autocomplete'));
        return $out;
    }

    private function styleRows(): string
    {
        $s = $this->store->settings;
        $out = Html::row(__('Light or dark list', 'kcpw-address-autocomplete'), Html::select('s[theme]', 'kcpw-aa-theme', (string) $s['theme'], [
            'match' => __('Match the form (recommended)', 'kcpw-address-autocomplete'),
            'light' => __('Always light', 'kcpw-address-autocomplete'),
            'dark' => __('Always dark', 'kcpw-address-autocomplete'),
            'system' => __('Follow the visitor\'s device setting', 'kcpw-address-autocomplete'),
        ]), '', 'kcpw-aa-theme');
        $out .= Html::row(__('Highlight color', 'kcpw-address-autocomplete'), Html::text('s[accent]', 'kcpw-aa-accent', (string) $s['accent'], 'small-text', 'maxlength="7" pattern="#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?"'), __('A hex color such as #2b59e6. It marks the active suggestion beside a background change, so it needs to stand out from white.', 'kcpw-address-autocomplete'), 'kcpw-aa-accent');
        $out .= Html::row(__('Corner roundness', 'kcpw-address-autocomplete'), Html::number('s[radius]', 'kcpw-aa-radius', (int) $s['radius'], 0, 24) . ' px', '', 'kcpw-aa-radius');
        return $out;
    }

    // ------------------------------------------------------------------------------------------------------------------
    // Handlers (POST to admin-post.php)
    // ------------------------------------------------------------------------------------------------------------------

    public function onSave(): void
    {
        $this->guard();
        $section = isset($_POST['section']) ? sanitize_key((string) wp_unslash($_POST['section'])) : '';
        if (!in_array($section, Settings::SECTIONS, true)) {
            $this->redirect(admin_url('admin.php?page=' . self::SLUG . '-settings&kcpw_msg=error'));
            return;
        }
        check_admin_referer('kcpw_aa_save_' . $section);
        $raw = isset($_POST['s']) && is_array($_POST['s']) ? wp_unslash($_POST['s']) : [];
        $this->saveSettings($section, $raw);
        $toDashboard = isset($_POST['return']) && wp_unslash($_POST['return']) === 'dashboard';
        $this->redirect(admin_url('admin.php?page=' . self::SLUG . ($toDashboard ? '' : '-settings&tab=' . $section) . ($toDashboard ? '&' : '&') . 'kcpw_msg=saved'));
    }

    /** @param array<string, mixed> $raw */
    public function saveSettings(string $section, array $raw): void
    {
        $this->store->saveSettings(Settings::applySection($this->store->settings, $raw, $section));
    }

    public function onWizard(): void
    {
        $this->guard();
        check_admin_referer('kcpw_aa_wizard');
        $step = isset($_POST['step']) ? (int) $_POST['step'] : 0;
        $raw = isset($_POST['w']) && is_array($_POST['w']) ? wp_unslash($_POST['w']) : [];
        $this->redirect((new Wizard($this->store))->handle($step, $raw));
    }

    /** Overridden in tests: the real one must stop the request after redirecting. */
    protected function redirect(string $url): void
    {
        wp_safe_redirect($url);
        exit;
    }

    private function guard(): void
    {
        if (!current_user_can(self::CAPABILITY)) {
            wp_die(esc_html__('You do not have permission to do that.', 'kcpw-address-autocomplete'), '', ['response' => 403]);
        }
    }

    private function keyField(string $name, string $id): string
    {
        $constant = $name === 'browser_key' ? 'KCPW_AA_BROWSER_KEY' : 'KCPW_AA_SERVER_KEY';
        $saved = (string) $this->store->effective()[$name];
        $out = '<input type="text" class="regular-text code" id="' . Html::a($id) . '" name="s[' . Html::a($name) . ']" value="" autocomplete="off" spellcheck="false" placeholder="' . Html::a($saved !== '' ? Settings::maskKey($saved) : __('Paste your key', 'kcpw-address-autocomplete')) . '">';
        if ($saved !== '') {
            $out .= '<br><label><input type="checkbox" name="s[clear_' . Html::a($name) . ']" value="1"> ' . Html::h(__('Remove the saved key', 'kcpw-address-autocomplete')) . '</label>';
        }
        if (defined($constant)) {
            $out .= '<br><em>' . Html::h(sprintf(__('%s is set in wp-config.php and is used instead of this field.', 'kcpw-address-autocomplete'), $constant)) . '</em>';
        }
        return $out;
    }

    private static function modeName(string $mode): string
    {
        return match ($mode) {
            Settings::MODE_LIVE => __('Live', 'kcpw-address-autocomplete'),
            Settings::MODE_PREVIEW => __('Preview', 'kcpw-address-autocomplete'),
            default => __('Off', 'kcpw-address-autocomplete'),
        };
    }

    private static function step(bool $done, string $title, string $detail): string
    {
        return '<li class="' . ($done ? 'is-done' : 'is-todo') . '"><span class="kcpw-aa-state">' . Html::h($done ? __('Done:', 'kcpw-address-autocomplete') : __('To do:', 'kcpw-address-autocomplete')) . '</span> <strong>' . Html::h($title) . '</strong> <span class="description">' . Html::h($detail) . '</span></li>';
    }

    /** @return array<string, string> */
    public static function adminStrings(): array
    {
        return [
            'testing' => __('Testing…', 'kcpw-address-autocomplete'),
            'ok' => __('Working', 'kcpw-address-autocomplete'),
            'fail' => __('Not working', 'kcpw-address-autocomplete'),
            'nokey' => __('Save a Google browser key first (Settings > General).', 'kcpw-address-autocomplete'),
            'load' => __('Google Maps script and key', 'kcpw-address-autocomplete'),
            'places' => __('Places API (New): address suggestions', 'kcpw-address-autocomplete'),
            'geocoding' => __('Geocoding API (only for the optional map picker and "use my location")', 'kcpw-address-autocomplete'),
            'hint_auth' => __('Google rejected the key. Check that it is typed in full, that the website restriction includes this admin address (for example https://yourshop.com/*), and that billing is on for the project.', 'kcpw-address-autocomplete'),
            'hint_script' => __('The Google script could not be loaded. Check that nothing (a security plugin, a firewall, an ad blocker) blocks maps.googleapis.com.', 'kcpw-address-autocomplete'),
            'hint_api' => __('This API is not turned on for the key\'s project, or the key is restricted to other APIs. Turn on "Places API (New)" in the API Library and add it to the key\'s API restrictions.', 'kcpw-address-autocomplete'),
            'hint_quota' => __('Google says the quota is used up. Check the quota and billing in Google Cloud.', 'kcpw-address-autocomplete'),
            'hint_billing' => __('Billing is not enabled for the Google project.', 'kcpw-address-autocomplete'),
            'hint_network' => __('The request did not reach Google. Try again; if it repeats, check the network.', 'kcpw-address-autocomplete'),
            'hint_conflict' => __('Another plugin has loaded an older Google Maps script on this page. Ask that plugin to use the current one, or switch its map off.', 'kcpw-address-autocomplete'),
            'hint_unknown' => __('Google returned an error this screen does not recognise. The browser console has the details.', 'kcpw-address-autocomplete'),
            'optional_skipped' => __('Skipped: not needed for the features you have switched on.', 'kcpw-address-autocomplete'),
        ];
    }
}
