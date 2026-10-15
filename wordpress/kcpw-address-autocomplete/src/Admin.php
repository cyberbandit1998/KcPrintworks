<?php
declare(strict_types=1);

namespace KcPrintworks\AddressAutocomplete;

/**
 * The administrator screens: Dashboard (status, key test, Google setup, usage), Settings, Forms.
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

    /**
     * @param array<string, mixed> $settings
     * @param list<array<string, mixed>> $forms
     */
    public function __construct(
        private readonly string $file,
        private readonly string $version,
        private array $settings,
        private array $forms,
    ) {
    }

    public function register(): void
    {
        add_action('admin_menu', [$this, 'menu']);
        add_action('admin_enqueue_scripts', [$this, 'assets']);
        add_action('admin_post_kcpw_aa_save', [$this, 'onSave']);
        add_action('admin_post_kcpw_aa_forms', [$this, 'onForms']);
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
        $json = wp_json_encode([
            'key' => (string) $this->effective()['browser_key'],
            'language' => (string) $this->settings['language'],
            'i18n' => self::adminStrings(),
        ], JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_UNESCAPED_SLASHES);
        wp_add_inline_script('kcpw-aa-admin', 'window.KCPW_AA_ADMIN=' . $json . ';', 'before');
    }

    // ------------------------------------------------------------------------------------------------------------------
    // Screens
    // ------------------------------------------------------------------------------------------------------------------

    public function renderDashboard(): void
    {
        $this->guard();
        echo $this->dashboardHtml(); // phpcs:ignore WordPress.Security.EscapeOutput -- built from escaped parts
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
        echo $this->formsHtml(); // phpcs:ignore WordPress.Security.EscapeOutput
    }

    public function dashboardHtml(): string
    {
        $s = $this->settings;
        $mode = (string) $s['mode'];
        $hasKey = (string) $this->effective()['browser_key'] !== '';
        $hasWoo = false;
        foreach ($this->forms as $form) {
            if (in_array($form['preset'] ?? '', ['woo_block', 'woo_classic'], true) && ($form['enabled'] ?? false) === true) {
                $hasWoo = true;
            }
        }
        $modeText = [
            Settings::MODE_OFF => __('Off: nothing is loaded for anyone.', 'kcpw-address-autocomplete'),
            Settings::MODE_PREVIEW => __('Preview: only logged-in administrators get address suggestions. Customers see your checkout exactly as before.', 'kcpw-address-autocomplete'),
            Settings::MODE_LIVE => __('Live: every visitor gets address suggestions on the pages you chose.', 'kcpw-address-autocomplete'),
        ];

        $out = '<div class="wrap kcpw-aa-admin"><h1>' . self::h(__('Address Autocomplete', 'kcpw-address-autocomplete')) . '</h1>';
        $out .= $this->notice();

        // 1. Status and the safe order of switching on.
        $out .= '<section class="kcpw-aa-card" aria-labelledby="kcpw-aa-h-status"><h2 id="kcpw-aa-h-status">' . self::h(__('Where things stand', 'kcpw-address-autocomplete')) . '</h2>';
        $out .= '<p class="kcpw-aa-mode" data-mode="' . self::a($mode) . '"><strong>' . self::h(self::modeName($mode)) . '.</strong> ' . self::h($modeText[$mode] ?? '') . '</p>';
        $out .= '<ol class="kcpw-aa-steps">';
        $out .= self::step($hasKey, __('Save your Google browser key', 'kcpw-address-autocomplete'), $hasKey ? __('A key is saved.', 'kcpw-address-autocomplete') : __('Settings > General.', 'kcpw-address-autocomplete'));
        $out .= self::step($hasWoo, __('Add the WooCommerce checkout', 'kcpw-address-autocomplete'), $hasWoo ? __('The checkout form is set up.', 'kcpw-address-autocomplete') : __('Press the button below.', 'kcpw-address-autocomplete'));
        $out .= self::step($mode !== Settings::MODE_OFF, __('Test it as an administrator in Preview mode', 'kcpw-address-autocomplete'), __('Open your checkout while logged in. Customers do not see it yet.', 'kcpw-address-autocomplete'));
        $out .= self::step($mode === Settings::MODE_LIVE, __('Switch to Live when you are happy', 'kcpw-address-autocomplete'), __('Only then do customers get suggestions.', 'kcpw-address-autocomplete'));
        $out .= '</ol>';

        $out .= '<div class="kcpw-aa-actions">';
        if (!$hasWoo) {
            $out .= $this->formsForm('add_preset', ['preset' => 'woo_block'], __('Add the WooCommerce checkout (block)', 'kcpw-address-autocomplete'), 'button button-primary');
        }
        foreach ([Settings::MODE_OFF => __('Turn off', 'kcpw-address-autocomplete'), Settings::MODE_PREVIEW => __('Preview (administrators only)', 'kcpw-address-autocomplete'), Settings::MODE_LIVE => __('Go live for customers', 'kcpw-address-autocomplete')] as $value => $text) {
            if ($value !== $mode) {
                $out .= $this->modeForm($value, $text);
            }
        }
        $out .= '</div></section>';

        // 2. Key test.
        $out .= '<section class="kcpw-aa-card" aria-labelledby="kcpw-aa-h-test"><h2 id="kcpw-aa-h-test">' . self::h(__('Test your Google key', 'kcpw-address-autocomplete')) . '</h2>';
        $out .= '<p>' . self::h(__('Loads Google in this browser with your saved browser key and tries each service the plugin uses. Nothing is changed and no customer is involved. A few test requests are billed to your Google project like any other.', 'kcpw-address-autocomplete')) . '</p>';
        $out .= '<p><button type="button" class="button" id="kcpw-aa-test"' . ($hasKey ? '' : ' disabled aria-disabled="true"') . '>' . self::h(__('Test my key', 'kcpw-address-autocomplete')) . '</button></p>';
        $out .= '<ul id="kcpw-aa-test-results" class="kcpw-aa-results" aria-live="polite"></ul></section>';

        // 3. Usage.
        $out .= $this->usageHtml();

        // 4. Google requirements.
        $out .= $this->googleSetupHtml();

        return $out . '</div>';
    }

    public function usageHtml(): string
    {
        $stored = function_exists('get_option') ? get_option(Usage::OPTION, []) : [];
        $summary = Usage::summary($stored, 30, gmdate('Y-m-d'));
        $t = $summary['totals'];
        $out = '<section class="kcpw-aa-card" aria-labelledby="kcpw-aa-h-usage"><h2 id="kcpw-aa-h-usage">' . self::h(__('API usage (last 30 days, estimated)', 'kcpw-address-autocomplete')) . '</h2>';
        if (($this->settings['usage_counters'] ?? true) !== true) {
            return $out . '<p>' . self::h(__('Usage counters are switched off (Settings > Behavior).', 'kcpw-address-autocomplete')) . '</p></section>';
        }
        $out .= '<p>' . self::h(__('Counted from your visitors\' browsers: whole numbers only, never an address or what anyone typed. Google\'s own report is the authority for your bill.', 'kcpw-address-autocomplete')) . '</p>';
        $out .= '<table class="widefat striped kcpw-aa-usage"><tbody>';
        $rows = [
            __('Suggestion requests (Autocomplete)', 'kcpw-address-autocomplete') => $t['requests'],
            __('Address lookups after a choice (Place Details)', 'kcpw-address-autocomplete') => $t['details'],
            __('Suggestions chosen (completed sessions)', 'kcpw-address-autocomplete') => $t['selections'],
            __('Customers who typed the address themselves after a failure', 'kcpw-address-autocomplete') => $t['manual'],
        ];
        foreach ($rows as $label => $value) {
            $out .= '<tr><th scope="row">' . self::h($label) . '</th><td>' . self::h(number_format_i18n((int) $value)) . '</td></tr>';
        }
        $out .= '</tbody></table>';
        if ($summary['errors'] !== []) {
            $parts = [];
            foreach ($summary['errors'] as $code => $n) {
                $parts[] = self::h($code . ': ' . $n);
            }
            $out .= '<p>' . self::h(__('Problems seen:', 'kcpw-address-autocomplete')) . ' ' . implode(', ', $parts) . '. ' . self::h(__('Run "Test my key" above.', 'kcpw-address-autocomplete')) . '</p>';
        }
        $out .= '<p><a href="https://console.cloud.google.com/google/maps-apis/metrics" target="_blank" rel="noopener noreferrer">' . self::h(__('Open Google\'s usage report', 'kcpw-address-autocomplete')) . '</a></p>';
        return $out . '</section>';
    }

    public function googleSetupHtml(): string
    {
        $link = static fn (string $url, string $text): string => '<a href="' . self::a($url) . '" target="_blank" rel="noopener noreferrer">' . self::h($text) . '</a>';
        $out = '<section class="kcpw-aa-card" aria-labelledby="kcpw-aa-h-google"><h2 id="kcpw-aa-h-google">' . self::h(__('Google setup: APIs, key and billing', 'kcpw-address-autocomplete')) . '</h2>';
        $out .= '<ol class="kcpw-aa-setup">';
        $out .= '<li><strong>' . self::h(__('A Google Cloud project with billing turned on.', 'kcpw-address-autocomplete')) . '</strong> ' . self::h(__('Google Maps Platform requires a billing account even when your use stays inside its free monthly allowance. The allowance and prices change: read the current ones before you go live.', 'kcpw-address-autocomplete')) . ' ' . $link('https://mapsplatform.google.com/pricing/', __('Google Maps Platform pricing', 'kcpw-address-autocomplete')) . '</li>';
        $out .= '<li><strong>' . self::h(__('Turn on these APIs', 'kcpw-address-autocomplete')) . '</strong> (' . $link('https://console.cloud.google.com/apis/library', __('API Library', 'kcpw-address-autocomplete')) . '): <em>Maps JavaScript API</em> and <em>Places API (New)</em> ' . self::h(__('are required.', 'kcpw-address-autocomplete')) . ' <em>Geocoding API</em> ' . self::h(__('is only needed for the optional map picker and "use my location". "Address Validation API" is only needed for the optional address check.', 'kcpw-address-autocomplete')) . '</li>';
        $out .= '<li><strong>' . self::h(__('Create a browser key', 'kcpw-address-autocomplete')) . '</strong> (' . $link('https://console.cloud.google.com/apis/credentials', __('Credentials', 'kcpw-address-autocomplete')) . '). ' . self::h(__('Under "Application restrictions" choose "Websites" and add your shop address, for example https://shop.kcprintworks.com/*. Under "API restrictions" allow only the APIs above. A browser key is visible to visitors by design; the restrictions are what keep others from using it.', 'kcpw-address-autocomplete')) . '</li>';
        $out .= '<li><strong>' . self::h(__('Set a spending limit', 'kcpw-address-autocomplete')) . '</strong> ' . self::h(__('In Google Cloud, set a budget alert and a daily quota for the Places API. That is the only limit nobody can bypass; the plugin\'s own pause after a number of requests is a courtesy.', 'kcpw-address-autocomplete')) . '</li>';
        $out .= '</ol>';
        $out .= '<p><strong>' . self::h(__('How the plugin keeps the cost down:', 'kcpw-address-autocomplete')) . '</strong> ' . self::h(__('Google is contacted only when a visitor first clicks into an address field, never when a page loads. Requests wait for a pause in typing and for at least a few characters. One session token covers a whole typing session. Repeated text is answered from memory. After a choice it asks only for the address parts. After a failure it stops asking on that page.', 'kcpw-address-autocomplete')) . '</p>';
        $out .= '<p><strong>' . self::h(__('Google\'s terms:', 'kcpw-address-autocomplete')) . '</strong> ' . self::h(__('The list shows "Powered by Google" next to the suggestions. Keep it: Google\'s terms require it when suggestions are not shown on a Google map, and there is deliberately no setting to hide it.', 'kcpw-address-autocomplete')) . ' ' . $link('https://cloud.google.com/maps-platform/terms', __('Google Maps Platform terms', 'kcpw-address-autocomplete')) . '</p>';
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
        $out = '<div class="wrap kcpw-aa-admin"><h1>' . self::h(__('Address Autocomplete settings', 'kcpw-address-autocomplete')) . '</h1>' . $this->notice();
        $out .= '<nav class="nav-tab-wrapper" aria-label="' . self::a(__('Settings sections', 'kcpw-address-autocomplete')) . '">';
        foreach ($tabs as $key => $label) {
            $out .= '<a class="nav-tab' . ($key === $tab ? ' nav-tab-active' : '') . '" href="' . self::a(admin_url('admin.php?page=' . self::SLUG . '-settings&tab=' . $key)) . '"' . ($key === $tab ? ' aria-current="page"' : '') . '>' . self::h($label) . '</a>';
        }
        $out .= '</nav>';
        $out .= '<form method="post" action="' . self::a(admin_url('admin-post.php')) . '">';
        $out .= '<input type="hidden" name="action" value="kcpw_aa_save"><input type="hidden" name="section" value="' . self::a($tab) . '">';
        $out .= wp_nonce_field('kcpw_aa_save_' . $tab, '_wpnonce', true, false);
        $out .= '<table class="form-table" role="presentation"><tbody>';
        $out .= match ($tab) {
            'behavior' => $this->behaviorRows(),
            'style' => $this->styleRows(),
            default => $this->generalRows(),
        };
        $out .= '</tbody></table><p class="submit"><button type="submit" class="button button-primary">' . self::h(__('Save changes', 'kcpw-address-autocomplete')) . '</button></p></form></div>';
        return $out;
    }

    private function generalRows(): string
    {
        $s = $this->settings;
        $out = self::row(__('Mode', 'kcpw-address-autocomplete'), self::radios('s[mode]', (string) $s['mode'], [
            Settings::MODE_OFF => __('Off: load nothing', 'kcpw-address-autocomplete'),
            Settings::MODE_PREVIEW => __('Preview: administrators only (safe for testing)', 'kcpw-address-autocomplete'),
            Settings::MODE_LIVE => __('Live: all visitors', 'kcpw-address-autocomplete'),
        ]), __('Start in Preview. Customers never see suggestions until you choose Live.', 'kcpw-address-autocomplete'));
        $out .= self::row(__('Google browser key', 'kcpw-address-autocomplete'), $this->keyField('browser_key', 'kcpw-aa-browser-key'), __('Used in visitors\' browsers. Restrict it to your website and to the Maps JavaScript and Places (New) APIs in Google Cloud. You can also set KCPW_AA_BROWSER_KEY in wp-config.php.', 'kcpw-address-autocomplete'), 'kcpw-aa-browser-key');
        $out .= self::row(__('Countries', 'kcpw-address-autocomplete'), '<input type="text" class="regular-text" id="kcpw-aa-countries" name="s[countries]" value="' . self::a(implode(', ', $s['countries'])) . '" maxlength="40" autocomplete="off" placeholder="US, CA">', __('Up to five two-letter country codes, separated by commas. Leave empty to suggest addresses everywhere.', 'kcpw-address-autocomplete'), 'kcpw-aa-countries');
        $out .= self::row(__('Language', 'kcpw-address-autocomplete'), '<input type="text" class="small-text" id="kcpw-aa-language" name="s[language]" value="' . self::a((string) $s['language']) . '" maxlength="8" autocomplete="off" placeholder="en">', __('A language code such as en or pt-BR. Empty means your site\'s language.', 'kcpw-address-autocomplete'), 'kcpw-aa-language');
        return $out;
    }

    private function behaviorRows(): string
    {
        $s = $this->settings;
        $out = self::row(__('Start suggesting after', 'kcpw-address-autocomplete'), self::number('s[min_chars]', 'kcpw-aa-min', (int) $s['min_chars'], 2, 6) . ' ' . self::h(__('characters', 'kcpw-address-autocomplete')), __('More characters means fewer, better requests.', 'kcpw-address-autocomplete'), 'kcpw-aa-min');
        $out .= self::row(__('Wait after typing', 'kcpw-address-autocomplete'), self::number('s[debounce_ms]', 'kcpw-aa-debounce', (int) $s['debounce_ms'], 200, 1000, 50) . ' ms', __('A pause in typing before Google is asked. 300 is a good balance.', 'kcpw-address-autocomplete'), 'kcpw-aa-debounce');
        $out .= self::row(__('Pause suggestions after', 'kcpw-address-autocomplete'), self::number('s[max_requests]', 'kcpw-aa-max', (int) $s['max_requests'], 3, 40) . ' ' . self::h(__('requests in one typing session', 'kcpw-address-autocomplete')), __('A safety net against runaway cost. The customer can still type the address.', 'kcpw-address-autocomplete'), 'kcpw-aa-max');
        $out .= self::row(__('What to suggest', 'kcpw-address-autocomplete'), self::select('s[place_types]', 'kcpw-aa-types', (string) $s['place_types'], [
            'address' => __('Street addresses', 'kcpw-address-autocomplete'),
            'all' => __('Everything Google knows (addresses, places, businesses)', 'kcpw-address-autocomplete'),
            'cities' => __('Cities only', 'kcpw-address-autocomplete'),
            'regions' => __('Regions only (states, countries, postal codes)', 'kcpw-address-autocomplete'),
            'business' => __('Businesses', 'kcpw-address-autocomplete'),
        ]), __('If a real address is missing from the suggestions, try "Everything".', 'kcpw-address-autocomplete'), 'kcpw-aa-types');
        $out .= self::row(__('Browser autofill', 'kcpw-address-autocomplete'), self::checkbox('s[disable_autofill]', 'kcpw-aa-autofill', (bool) $s['disable_autofill'], __('Ask the browser not to show its own address list over ours', 'kcpw-address-autocomplete')), '');
        $out .= self::row(__('When suggestions fail', 'kcpw-address-autocomplete'), self::checkbox('s[show_fallback_notice]', 'kcpw-aa-notice', (bool) $s['show_fallback_notice'], __('Tell the customer once, in plain words, that they can type the address themselves', 'kcpw-address-autocomplete')), __('The address fields always keep working, with or without this message.', 'kcpw-address-autocomplete'));
        $out .= self::row(__('Usage counters', 'kcpw-address-autocomplete'), self::checkbox('s[usage_counters]', 'kcpw-aa-usage', (bool) $s['usage_counters'], __('Count requests, choices and failures (whole numbers only, never addresses)', 'kcpw-address-autocomplete')), __('Feeds the "API usage" panel on the Dashboard.', 'kcpw-address-autocomplete'));
        return $out;
    }

    private function styleRows(): string
    {
        $s = $this->settings;
        $out = self::row(__('Light or dark list', 'kcpw-address-autocomplete'), self::select('s[theme]', 'kcpw-aa-theme', (string) $s['theme'], [
            'match' => __('Match the form (recommended)', 'kcpw-address-autocomplete'),
            'light' => __('Always light', 'kcpw-address-autocomplete'),
            'dark' => __('Always dark', 'kcpw-address-autocomplete'),
            'system' => __('Follow the visitor\'s device setting', 'kcpw-address-autocomplete'),
        ]), '', 'kcpw-aa-theme');
        $out .= self::row(__('Highlight color', 'kcpw-address-autocomplete'), '<input type="text" class="small-text" id="kcpw-aa-accent" name="s[accent]" value="' . self::a((string) $s['accent']) . '" maxlength="7" pattern="#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?" autocomplete="off">', __('A hex color such as #2b59e6. It marks the active suggestion beside a background change, so it needs to stand out from white.', 'kcpw-address-autocomplete'), 'kcpw-aa-accent');
        $out .= self::row(__('Corner roundness', 'kcpw-address-autocomplete'), self::number('s[radius]', 'kcpw-aa-radius', (int) $s['radius'], 0, 24) . ' px', '', 'kcpw-aa-radius');
        return $out;
    }

    public function formsHtml(): string
    {
        $out = '<div class="wrap kcpw-aa-admin"><h1>' . self::h(__('Address forms', 'kcpw-address-autocomplete')) . '</h1>' . $this->notice();
        $out .= '<p>' . self::h(__('A "form" says where suggestions appear and which fields get filled. Start with your WooCommerce checkout.', 'kcpw-address-autocomplete')) . '</p>';
        if ($this->forms === []) {
            $out .= '<p><em>' . self::h(__('No forms yet.', 'kcpw-address-autocomplete')) . '</em></p>';
        } else {
            $out .= '<table class="widefat striped"><thead><tr><th scope="col">' . self::h(__('Name', 'kcpw-address-autocomplete')) . '</th><th scope="col">' . self::h(__('Where', 'kcpw-address-autocomplete')) . '</th><th scope="col">' . self::h(__('Status', 'kcpw-address-autocomplete')) . '</th><th scope="col">' . self::h(__('Actions', 'kcpw-address-autocomplete')) . '</th></tr></thead><tbody>';
            foreach ($this->forms as $form) {
                $on = ($form['enabled'] ?? false) === true;
                $out .= '<tr><th scope="row">' . self::h((string) $form['name']) . '</th><td>' . self::h(self::whereText($form)) . '</td><td>' . self::h($on ? __('On', 'kcpw-address-autocomplete') : __('Off', 'kcpw-address-autocomplete')) . '</td><td class="kcpw-aa-row-actions">';
                $out .= $this->formsForm('toggle', ['id' => (string) $form['id']], $on ? __('Turn off', 'kcpw-address-autocomplete') : __('Turn on', 'kcpw-address-autocomplete'), 'button button-small');
                $out .= $this->formsForm('delete', ['id' => (string) $form['id']], __('Delete', 'kcpw-address-autocomplete'), 'button button-small button-link-delete');
                $out .= '</td></tr>';
            }
            $out .= '</tbody></table>';
        }
        $out .= '<h2>' . self::h(__('Add a form', 'kcpw-address-autocomplete')) . '</h2><ul class="kcpw-aa-presets">';
        foreach (Presets::all() as $key => $preset) {
            if (!in_array($key, ['woo_block', 'woo_classic'], true)) {
                continue;
            }
            $out .= '<li><strong>' . self::h($preset['label']) . '</strong><br><span>' . self::h($preset['help']) . '</span> ' . $this->formsForm('add_preset', ['preset' => $key], __('Add', 'kcpw-address-autocomplete'), 'button') . '</li>';
        }
        return $out . '</ul></div>';
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
        $this->redirect(admin_url('admin.php?page=' . self::SLUG . '-settings&tab=' . $section . '&kcpw_msg=saved'));
    }

    /** @param array<string, mixed> $raw */
    public function saveSettings(string $section, array $raw): void
    {
        $this->settings = Settings::applySection($this->settings, $raw, $section);
        update_option(Settings::OPTION, $this->settings, false);
    }

    public function onForms(): void
    {
        $this->guard();
        check_admin_referer('kcpw_aa_forms');
        $do = isset($_POST['do']) ? sanitize_key((string) wp_unslash($_POST['do'])) : '';
        $id = isset($_POST['id']) ? sanitize_key((string) wp_unslash($_POST['id'])) : '';
        $preset = isset($_POST['preset']) ? sanitize_key((string) wp_unslash($_POST['preset'])) : '';
        $ok = $this->formsAction($do, $id, $preset);
        $this->redirect(admin_url('admin.php?page=' . self::SLUG . '-forms&kcpw_msg=' . ($ok ? 'saved' : 'error')));
    }

    public function formsAction(string $do, string $id, string $preset): bool
    {
        $forms = $this->forms;
        switch ($do) {
            case 'add_preset':
                if (!isset(Presets::all()[$preset]) || count($forms) >= FormConfig::MAX_FORMS) {
                    return false;
                }
                $forms[] = FormConfig::blank($preset);
                break;
            case 'toggle':
            case 'delete':
                $found = false;
                foreach ($forms as $i => $form) {
                    if (($form['id'] ?? '') === $id) {
                        $found = true;
                        if ($do === 'toggle') {
                            $forms[$i]['enabled'] = !($form['enabled'] ?? false);
                        } else {
                            unset($forms[$i]);
                        }
                    }
                }
                if (!$found) {
                    return false;
                }
                break;
            default:
                return false;
        }
        $this->forms = FormConfig::sanitizeList(array_values($forms));
        update_option(FormConfig::OPTION, $this->forms, false);
        return true;
    }

    // ------------------------------------------------------------------------------------------------------------------
    // Pieces
    // ------------------------------------------------------------------------------------------------------------------

    /** Overridden in tests: the real one must stop the request after redirecting. */
    protected function redirect(string $url): void
    {
        wp_safe_redirect($url);
        exit;
    }

    /** @return array<string, mixed> the settings with wp-config.php constants applied (read only) */
    private function effective(): array
    {
        return Settings::effective(
            $this->settings,
            defined('KCPW_AA_BROWSER_KEY') ? constant('KCPW_AA_BROWSER_KEY') : null,
            defined('KCPW_AA_SERVER_KEY') ? constant('KCPW_AA_SERVER_KEY') : null,
        );
    }

    private function guard(): void
    {
        if (!current_user_can(self::CAPABILITY)) {
            wp_die(esc_html__('You do not have permission to do that.', 'kcpw-address-autocomplete'), '', ['response' => 403]);
        }
    }

    private function notice(): string
    {
        $msg = isset($_GET['kcpw_msg']) ? sanitize_key((string) wp_unslash($_GET['kcpw_msg'])) : '';
        if ($msg === 'saved') {
            return '<div class="notice notice-success is-dismissible"><p>' . self::h(__('Saved.', 'kcpw-address-autocomplete')) . '</p></div>';
        }
        if ($msg === 'error') {
            return '<div class="notice notice-error"><p>' . self::h(__('That did not work. Nothing was changed.', 'kcpw-address-autocomplete')) . '</p></div>';
        }
        return '';
    }

    /** @param array<string, string> $fields */
    private function formsForm(string $do, array $fields, string $label, string $class): string
    {
        $out = '<form class="kcpw-aa-inline" method="post" action="' . self::a(admin_url('admin-post.php')) . '"><input type="hidden" name="action" value="kcpw_aa_forms"><input type="hidden" name="do" value="' . self::a($do) . '">';
        foreach ($fields as $name => $value) {
            $out .= '<input type="hidden" name="' . self::a($name) . '" value="' . self::a($value) . '">';
        }
        $out .= wp_nonce_field('kcpw_aa_forms', '_wpnonce', true, false);
        return $out . '<button type="submit" class="' . self::a($class) . '">' . self::h($label) . '</button></form>';
    }

    private function modeForm(string $mode, string $label): string
    {
        $confirm = $mode === Settings::MODE_LIVE ? ' data-confirm="' . self::a(__('Customers will see address suggestions on your checkout right away. Continue?', 'kcpw-address-autocomplete')) . '"' : '';
        $out = '<form class="kcpw-aa-inline" method="post" action="' . self::a(admin_url('admin-post.php')) . '"' . $confirm . '><input type="hidden" name="action" value="kcpw_aa_save"><input type="hidden" name="section" value="general"><input type="hidden" name="s[mode]" value="' . self::a($mode) . '">';
        $out .= wp_nonce_field('kcpw_aa_save_general', '_wpnonce', true, false);
        return $out . '<button type="submit" class="button">' . self::h($label) . '</button></form>';
    }

    private function keyField(string $name, string $id): string
    {
        $constant = $name === 'browser_key' ? 'KCPW_AA_BROWSER_KEY' : 'KCPW_AA_SERVER_KEY';
        $saved = (string) $this->effective()[$name];
        $out = '<input type="text" class="regular-text code" id="' . self::a($id) . '" name="s[' . self::a($name) . ']" value="" autocomplete="off" spellcheck="false" placeholder="' . self::a($saved !== '' ? Settings::maskKey($saved) : __('Paste your key', 'kcpw-address-autocomplete')) . '">';
        if ($saved !== '') {
            $out .= '<br><label><input type="checkbox" name="s[clear_' . self::a($name) . ']" value="1"> ' . self::h(__('Remove the saved key', 'kcpw-address-autocomplete')) . '</label>';
        }
        if (defined($constant)) {
            $out .= '<br><em>' . self::h(sprintf(__('%s is set in wp-config.php and is used instead of this field.', 'kcpw-address-autocomplete'), $constant)) . '</em>';
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

    /** @param array<string, mixed> $form */
    private static function whereText(array $form): string
    {
        $mode = $form['pages']['mode'] ?? 'selected';
        $text = match ($mode) {
            'checkout' => __('The WooCommerce checkout page', 'kcpw-address-autocomplete'),
            'all' => __('Every page', 'kcpw-address-autocomplete'),
            default => __('Selected pages', 'kcpw-address-autocomplete'),
        };
        return ($form['pages']['account_address'] ?? false) === true ? $text . ' + ' . __('My Account addresses', 'kcpw-address-autocomplete') : $text;
    }

    private static function step(bool $done, string $title, string $detail): string
    {
        return '<li class="' . ($done ? 'is-done' : 'is-todo') . '"><span class="kcpw-aa-state">' . self::h($done ? __('Done:', 'kcpw-address-autocomplete') : __('To do:', 'kcpw-address-autocomplete')) . '</span> <strong>' . self::h($title) . '</strong> <span class="description">' . self::h($detail) . '</span></li>';
    }

    private static function row(string $label, string $control, string $help = '', string $for = ''): string
    {
        $th = $for !== '' ? '<label for="' . self::a($for) . '">' . self::h($label) . '</label>' : self::h($label);
        return '<tr><th scope="row">' . $th . '</th><td>' . $control . ($help !== '' ? '<p class="description">' . self::h($help) . '</p>' : '') . '</td></tr>';
    }

    /** @param array<string, string> $options */
    private static function radios(string $name, string $current, array $options): string
    {
        $out = '<fieldset>';
        foreach ($options as $value => $label) {
            $out .= '<label class="kcpw-aa-radio"><input type="radio" name="' . self::a($name) . '" value="' . self::a($value) . '"' . ($value === $current ? ' checked' : '') . '> ' . self::h($label) . '</label><br>';
        }
        return $out . '</fieldset>';
    }

    /** @param array<string, string> $options */
    private static function select(string $name, string $id, string $current, array $options): string
    {
        $out = '<select name="' . self::a($name) . '" id="' . self::a($id) . '">';
        foreach ($options as $value => $label) {
            $out .= '<option value="' . self::a($value) . '"' . ($value === $current ? ' selected' : '') . '>' . self::h($label) . '</option>';
        }
        return $out . '</select>';
    }

    private static function number(string $name, string $id, int $value, int $min, int $max, int $step = 1): string
    {
        return '<input type="number" class="small-text" name="' . self::a($name) . '" id="' . self::a($id) . '" value="' . $value . '" min="' . $min . '" max="' . $max . '" step="' . $step . '">';
    }

    private static function checkbox(string $name, string $id, bool $checked, string $label): string
    {
        // The hidden 0 is what makes an unticked box reach the server as "off".
        return '<input type="hidden" name="' . self::a($name) . '" value="0"><label for="' . self::a($id) . '"><input type="checkbox" name="' . self::a($name) . '" id="' . self::a($id) . '" value="1"' . ($checked ? ' checked' : '') . '> ' . self::h($label) . '</label>';
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

    private static function h(string $text): string
    {
        return esc_html($text);
    }

    private static function a(string $text): string
    {
        return esc_attr($text);
    }
}
