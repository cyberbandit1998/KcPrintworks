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

    private readonly Http $google;

    public function __construct(
        private readonly string $file,
        private readonly string $version,
        private readonly Store $store,
        ?Http $google = null,
    ) {
        $this->google = $google ?? new WpHttp(false);
    }

    public function register(): void
    {
        add_action('admin_menu', [$this, 'menu']);
        add_action('admin_enqueue_scripts', [$this, 'assets']);
        add_action('admin_post_kcpw_aa_save', [$this, 'onSave']);
        add_action('admin_post_kcpw_aa_wizard', [$this, 'onWizard']);
        add_action('admin_post_kcpw_aa_test_server', [$this, 'onTestServer']);
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

        // 3. Optional features, conflicts, usage, Google requirements.
        $out .= $this->featuresStatusHtml();
        $out .= $this->conflictsHtml();
        $out .= $this->usageHtml();
        $out .= $this->googleSetupHtml();

        return $out . '</div>';
    }

    /** One line per optional feature: on or off, and what it still needs. Shows nothing at all while every feature is off. */
    public function featuresStatusHtml(): string
    {
        $s = $this->store->effective();
        $modules = is_array($s['modules'] ?? null) ? $s['modules'] : [];
        $names = [
            'pobox' => __('PO box notice', 'kcpw-address-autocomplete'),
            'validation' => __('Address check', 'kcpw-address-autocomplete'),
            'gps' => __('Use my location', 'kcpw-address-autocomplete'),
            'map_picker' => __('Choose on a map', 'kcpw-address-autocomplete'),
        ];
        $items = '';
        foreach ($names as $id => $label) {
            if (($modules[$id] ?? false) !== true) {
                continue;
            }
            $needs = $id === 'validation' && trim((string) $s['server_key']) === '' ? __('needs a server key (Settings > Features)', 'kcpw-address-autocomplete') : '';
            $items .= '<li class="' . ($needs === '' ? 'is-done' : 'is-todo') . '"><span class="kcpw-aa-state">' . Html::h($needs === '' ? __('On:', 'kcpw-address-autocomplete') : __('To do:', 'kcpw-address-autocomplete')) . '</span> <strong>' . Html::h($label) . '</strong>' . ($needs !== '' ? ' <span class="description">' . Html::h($needs) . '</span>' : '') . '</li>';
        }
        $optins = '';
        foreach (['webhook' => __('Webhook', 'kcpw-address-autocomplete'), 'abandonment' => __('Checkout counting', 'kcpw-address-autocomplete'), 'ip' => __('Location hint', 'kcpw-address-autocomplete')] as $name => $label) {
            if (Settings::optInEnabled($s, $name)) {
                $optins .= '<li class="is-done"><span class="kcpw-aa-state">' . Html::h(__('On (opt-in):', 'kcpw-address-autocomplete')) . '</span> <strong>' . Html::h($label) . '</strong></li>';
            }
        }
        if ($items === '' && $optins === '') {
            return '';
        }
        $out = '<section class="kcpw-aa-card" aria-labelledby="kcpw-aa-h-features"><h2 id="kcpw-aa-h-features">' . Html::h(__('Optional features switched on', 'kcpw-address-autocomplete')) . '</h2><ul class="kcpw-aa-steps">' . $items . $optins . '</ul>';
        return $out . '<p class="description">' . Html::h(__('Each one loads its own small file only on a page whose form uses it. Turn any of them off in Settings > Features and Settings > Privacy.', 'kcpw-address-autocomplete')) . '</p></section>';
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
            __('Address lookups after a choice (Place Details; Geocoding for "use my location" and the map)', 'kcpw-address-autocomplete') => $t['details'],
            __('Suggestions chosen (completed sessions)', 'kcpw-address-autocomplete') => $t['selections'],
            __('Customers who typed the address themselves after a failure', 'kcpw-address-autocomplete') => $t['manual'],
        ];
        if (($this->store->settings['modules']['validation'] ?? false) === true) {
            $rows[__('Address checks asked of Google (counted on this server; repeats are answered from memory)', 'kcpw-address-autocomplete')] = $t['validations'];
        }
        if (Settings::optInEnabled($this->store->settings, 'abandonment')) {
            $rows[__('Checkouts started (opt-in; a number only)', 'kcpw-address-autocomplete')] = $t['checkoutsStarted'];
            $rows[__('Orders completed (opt-in; a number only)', 'kcpw-address-autocomplete')] = $t['checkoutsCompleted'];
        }
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
        $out .= '<li><strong>' . Html::h(__('Turn on these APIs', 'kcpw-address-autocomplete')) . '</strong> (' . $link('https://console.cloud.google.com/apis/library', __('API Library', 'kcpw-address-autocomplete')) . '): <em>Maps JavaScript API</em> and <em>Places API (New)</em> ' . Html::h(__('are required.', 'kcpw-address-autocomplete')) . ' <em>Geocoding API</em> ' . Html::h(__('is only needed for the optional map picker and "use my location". "Address Validation API" is only needed for the optional address check, and that one is called from your server with a separate server key (Settings > Features).', 'kcpw-address-autocomplete')) . '</li>';
        $out .= '<li><strong>' . Html::h(__('Create a browser key', 'kcpw-address-autocomplete')) . '</strong> (' . $link('https://console.cloud.google.com/apis/credentials', __('Credentials', 'kcpw-address-autocomplete')) . '). ' . Html::h(__('Under "Application restrictions" choose "Websites" and add your shop address, for example https://shop.kcprintworks.com/*. Under "API restrictions" allow only the APIs above. A browser key is visible to visitors by design; the restrictions are what keep others from using it.', 'kcpw-address-autocomplete')) . '</li>';
        $out .= '<li><strong>' . Html::h(__('Set a spending limit', 'kcpw-address-autocomplete')) . '</strong> ' . Html::h(__('In Google Cloud, set a budget alert and a daily quota for the Places API. That is the only limit nobody can bypass; the plugin\'s own pause after a number of requests is a courtesy.', 'kcpw-address-autocomplete')) . '</li>';
        $out .= '</ol>';
        $out .= '<p><strong>' . Html::h(__('How the plugin keeps the cost down:', 'kcpw-address-autocomplete')) . '</strong> ' . Html::h(__('Google is contacted only when a visitor first clicks into an address field, never when a page loads. Requests wait for a pause in typing and for at least a few characters. One session token covers a whole typing session. Repeated text is answered from memory. After a choice it asks only for the address parts. After a failure it stops asking on that page.', 'kcpw-address-autocomplete')) . '</p>';
        $out .= '<p><strong>' . Html::h(__('Google\'s terms:', 'kcpw-address-autocomplete')) . '</strong> ' . Html::h(__('The list shows "Powered by Google" next to the suggestions. Keep it: Google\'s terms require it when suggestions are not shown on a Google map, and there is deliberately no setting to hide it.', 'kcpw-address-autocomplete')) . ' ' . $link('https://cloud.google.com/maps-platform/terms', __('Google Maps Platform terms', 'kcpw-address-autocomplete')) . '</p>';
        return $out . '</section>';
    }

    /** @param string $tab general|behavior|style|modules|optins */
    public function settingsHtml(string $tab): string
    {
        $tabs = [
            'general' => __('General', 'kcpw-address-autocomplete'),
            'behavior' => __('Behavior', 'kcpw-address-autocomplete'),
            'style' => __('Appearance', 'kcpw-address-autocomplete'),
            'modules' => __('Features', 'kcpw-address-autocomplete'),
            'optins' => __('Privacy and opt-ins', 'kcpw-address-autocomplete'),
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
            'modules' => $this->modulesRows(),
            'optins' => $this->optinsRows(),
            default => $this->generalRows(),
        };
        $out .= '</tbody></table><p class="submit"><button type="submit" class="button button-primary">' . Html::h(__('Save changes', 'kcpw-address-autocomplete')) . '</button></p></form>';
        if ($tab === 'modules') {
            // The "Test the server key" button sits inside the settings form's table but submits THIS form (the `form` attribute), so the
            // two never nest.
            $out .= '<form id="kcpw-aa-test-server" method="post" action="' . Html::a(admin_url('admin-post.php')) . '"><input type="hidden" name="action" value="kcpw_aa_test_server">' . wp_nonce_field('kcpw_aa_test_server', '_wpnonce', true, false) . '</form>';
        }
        return $out . '</div>';
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

    /** The optional features. Everything here starts off; each is a separate small file that only a page whose form uses it downloads. */
    private function modulesRows(): string
    {
        $s = $this->store->settings;
        $m = is_array($s['modules'] ?? null) ? $s['modules'] : [];
        $on = static fn (string $id): bool => ($m[$id] ?? false) === true;
        $out = '<tr><td colspan="2"><p>' . Html::h(__('Every feature below is off until you switch it on, and nothing here changes how the address suggestions themselves work. Switch them on one at a time while the plugin is in Preview, and test your checkout between each. Each one loads its own small file only on a page whose form uses it, so a checkout that uses none of them downloads none.', 'kcpw-address-autocomplete')) . '</p></td></tr>';
        $out .= Html::row(__('PO box notice', 'kcpw-address-autocomplete'), Html::checkbox('s[modules][pobox]', 'kcpw-aa-m-pobox', $on('pobox'), __('Tell customers when the street line looks like a PO box or a military (APO/FPO) address', 'kcpw-address-autocomplete')) . '<br>' . Html::radios('s[pobox_mode]', (string) $s['pobox_mode'], [
            'warn' => __('Only tell them (the order always goes through)', 'kcpw-address-autocomplete'),
            'block' => __('Refuse PO boxes at checkout (Live mode only; never military addresses)', 'kcpw-address-autocomplete'),
        ], __('What to do about a PO box', 'kcpw-address-autocomplete')), __('Needs no Google service. "Refuse" is enforced by your server when the order is placed (classic checkout and the Checkout Block), only while the plugin is Live. It has not been run against a real WooCommerce here: try it on a staging copy first.', 'kcpw-address-autocomplete'));
        $out .= Html::row(__('Address check', 'kcpw-address-autocomplete'), Html::checkbox('s[modules][validation]', 'kcpw-aa-m-validation', $on('validation'), __('After an address is filled in or edited, check it with Google and show "looks right" or "please double-check"', 'kcpw-address-autocomplete')), __('Advice only: it never stops an order. Needs the Address Validation API and the server key below. Google bills each check; repeated addresses are answered from memory, and a daily limit applies.', 'kcpw-address-autocomplete'));
        $out .= Html::row(__('Google server key', 'kcpw-address-autocomplete'), $this->keyField('server_key', 'kcpw-aa-server-key') . '<p><button type="submit" class="button" form="kcpw-aa-test-server">' . Html::h(__('Test the server key', 'kcpw-address-autocomplete')) . '</button></p>', __('Used only by your server, never sent to a browser. Create a second key in Google Cloud, restrict it to the Address Validation API and to your server\'s IP address (not to websites). You can also set KCPW_AA_SERVER_KEY in wp-config.php. The test makes one real, billed check of a Google address.', 'kcpw-address-autocomplete'), 'kcpw-aa-server-key');
        $out .= Html::row(__('Most address checks per day', 'kcpw-address-autocomplete'), Html::number('s[validation_daily_cap]', 'kcpw-aa-cap', (int) $s['validation_daily_cap'], 10, 5000, 10), __('A ceiling on what the address check can cost in a day, whoever asks. At the limit it simply says nothing.', 'kcpw-address-autocomplete'), 'kcpw-aa-cap');
        $out .= Html::row(__('Use my location', 'kcpw-address-autocomplete'), Html::checkbox('s[modules][gps]', 'kcpw-aa-m-gps', $on('gps'), __('Offer a "Use my location" button', 'kcpw-address-autocomplete')), __('Only when the customer presses it, and the browser asks their permission first. Their position goes from their browser to Google\'s Geocoding service, nowhere else; it is not stored. Needs the Geocoding API.', 'kcpw-address-autocomplete'));
        $out .= Html::row(__('Choose on a map', 'kcpw-address-autocomplete'), Html::checkbox('s[modules][map_picker]', 'kcpw-aa-m-map', $on('map_picker'), __('Offer a "Choose on a map" button', 'kcpw-address-autocomplete')), __('Opens a window with a Google map only when pressed. Works with a mouse, touch or the keyboard. Needs the Maps JavaScript API (a map load is billed) and the Geocoding API.', 'kcpw-address-autocomplete'));
        $out .= Html::row(__('Map ID', 'kcpw-address-autocomplete'), Html::text('s[map_id]', 'kcpw-aa-map-id', (string) $s['map_id'], 'regular-text', 'maxlength="64"'), __('Google\'s markers need a Map ID. "DEMO_MAP_ID" works for testing; create your own free one in Google Cloud (Map Management) for production.', 'kcpw-address-autocomplete'), 'kcpw-aa-map-id');
        return $out;
    }

    /** The three things that send data somewhere or count visitors, each off until it is switched on here with the facts in front of the owner. */
    private function optinsRows(): string
    {
        $o = is_array($this->store->settings['optins'] ?? null) ? $this->store->settings['optins'] : Settings::defaults()['optins'];
        $w = is_array($o['webhook'] ?? null) ? $o['webhook'] : Settings::defaults()['optins']['webhook'];
        $a = is_array($o['abandonment'] ?? null) ? $o['abandonment'] : [];
        $ip = is_array($o['ip'] ?? null) ? $o['ip'] : Settings::defaults()['optins']['ip'];
        $state = static fn (bool $on): string => '<p class="description"><strong>' . Html::h($on ? __('Currently on.', 'kcpw-address-autocomplete') : __('Currently off.', 'kcpw-address-autocomplete')) . '</strong></p>';

        $out = '<tr><td colspan="2"><p>' . Html::h(__('Nothing on this page is on unless you switch it on. By default this plugin sends no address, no name and no visitor detail to anyone but Google (for the suggestions the visitor asked for). The usage counters on the Dashboard are whole numbers only.', 'kcpw-address-autocomplete')) . '</p></td></tr>';

        $events = is_array($w['events'] ?? null) ? $w['events'] : [];
        // An empty entry first, so unticking every box is still sent (and saved) as "none".
        $eventBoxes = '<input type="hidden" name="s[optins][webhook][events][]" value="">';
        foreach (Webhook::EVENTS as $key => $text) {
            $eventBoxes .= '<label class="kcpw-aa-radio"><input type="checkbox" name="s[optins][webhook][events][]" value="' . Html::a($key) . '"' . (in_array($key, $events, true) ? ' checked' : '') . '> ' . Html::h(sprintf(/* translators: %s: what the check found */ __('When an address %s', 'kcpw-address-autocomplete'), $text)) . '</label><br>';
        }
        $out .= Html::row(__('Webhook', 'kcpw-address-autocomplete'),
            Html::checkbox('s[optins][webhook][enabled]', 'kcpw-aa-o-webhook', ($w['enabled'] ?? false) === true, __('Send a short message to a web address I choose when the address check finds a problem', 'kcpw-address-autocomplete'))
            . '<p>' . Html::checkbox('s[optins][webhook][consent]', 'kcpw-aa-o-consent', ($w['consent'] ?? false) === true, __('I understand this sends information from my shop to the address below, and I have the right to do that', 'kcpw-address-autocomplete')) . '</p>'
            . '<p><label for="kcpw-aa-o-url">' . Html::h(__('Address to send to (must start with https://)', 'kcpw-address-autocomplete')) . '</label><br>' . Html::text('s[optins][webhook][url]', 'kcpw-aa-o-url', (string) ($w['url'] ?? ''), 'large-text code', 'placeholder="https://hooks.example.com/..."') . '</p>'
            . '<fieldset><legend>' . Html::h(__('Send a message', 'kcpw-address-autocomplete')) . '</legend>' . $eventBoxes . '</fieldset>'
            . '<p>' . Html::checkbox('s[optins][webhook][include_address]', 'kcpw-aa-o-include', ($w['include_address'] ?? false) === true, __('Also include the customer\'s address in the message (their street, city, postal code and country leave this site)', 'kcpw-address-autocomplete')) . '</p>'
            . $state(Settings::optInEnabled($this->store->settings, 'webhook')),
            __('Needs the address check (above) to be on, because that is what finds problems. By default a message says only that a check found a problem, which kind, your site and the form: no address. It is sent once, without waiting for an answer, and the same address does not ring twice within an hour. It is switched on only with the first box, the consent box and a valid https address.', 'kcpw-address-autocomplete'));

        $out .= Html::row(__('Checkout counting', 'kcpw-address-autocomplete'),
            Html::checkbox('s[optins][abandonment][enabled]', 'kcpw-aa-o-count', ($a['enabled'] ?? false) === true, __('Count how many checkouts were started and how many orders finished', 'kcpw-address-autocomplete')) . $state(Settings::optInEnabled($this->store->settings, 'abandonment')),
            __('Two numbers on the Dashboard, added up per day, so you can see roughly how many people start checkout and do not finish. Nothing about any person or order is stored (a short-lived marker keyed by the order number stops a refreshed thank-you page counting twice). Counted only while the plugin is Live. It is a rough guide: visitors who block scripts, or pay with a wallet button, are not all counted.', 'kcpw-address-autocomplete'));

        $source = (string) ($ip['source'] ?? 'header');
        $out .= Html::row(__('Location hint', 'kcpw-address-autocomplete'),
            Html::checkbox('s[optins][ip][enabled]', 'kcpw-aa-o-ip', ($ip['enabled'] ?? false) === true, __('Use the visitor\'s approximate country to rank suggestions better', 'kcpw-address-autocomplete'))
            . Html::radios('s[optins][ip][source]', $source, [
                'header' => __('Read the country your CDN already adds to each request (Cloudflare: CF-IPCountry). No outside call.', 'kcpw-address-autocomplete'),
                'service' => __('Ask an IP lookup service I name. The visitor\'s IP address is sent to that service.', 'kcpw-address-autocomplete'),
            ], __('Where the country comes from', 'kcpw-address-autocomplete'))
            . '<p><label for="kcpw-aa-o-service">' . Html::h(__('Lookup service address, with {ip} where the visitor\'s IP address goes (https only)', 'kcpw-address-autocomplete')) . '</label><br>' . Html::text('s[optins][ip][service_url]', 'kcpw-aa-o-service', (string) ($ip['service_url'] ?? ''), 'large-text code', 'placeholder="https://lookup.example.com/json/{ip}"') . '</p>'
            . $state(Settings::optInEnabled($this->store->settings, 'ip')),
            __('It only softens the order of suggestions (they never get limited or filled by it), and a form that already limits the countries ignores it. A position from a lookup service is rounded to about a city before it is used, and nothing is stored with the visitor\'s address except a one-way hash, for six hours, so a returning visitor is not looked up again. Using a lookup service shares visitors\' IP addresses with a third party: check that your privacy notice says so.', 'kcpw-address-autocomplete'));
        return $out;
    }

    // ------------------------------------------------------------------------------------------------------------------
    // Handlers (POST to admin-post.php)
    // ------------------------------------------------------------------------------------------------------------------

    /** The "Test the server key" button: one real Address Validation request for a known Google address. */
    public function onTestServer(): void
    {
        $this->guard();
        check_admin_referer('kcpw_aa_test_server');
        $key = trim((string) $this->store->effective()['server_key']);
        if ($key === '') {
            $this->redirect(admin_url('admin.php?page=' . self::SLUG . '-settings&tab=modules&kcpw_msg=server_nokey'));
            return;
        }
        $result = (new GoogleServer($this->google, $key))->test();
        $why = $result['ok'] ? 'ok' : (in_array($result['reason'], ['auth', 'api', 'quota', 'network'], true) ? $result['reason'] : 'other');
        $this->redirect(admin_url('admin.php?page=' . self::SLUG . '-settings&tab=modules&kcpw_msg=server_' . $why));
    }

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
