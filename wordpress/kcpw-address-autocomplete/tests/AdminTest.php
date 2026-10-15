<?php
declare(strict_types=1);

namespace KcPrintworks\AddressAutocomplete\Tests;

use KcPrintworks\AddressAutocomplete\Admin;
use KcPrintworks\AddressAutocomplete\FormConfig;
use KcPrintworks\AddressAutocomplete\Settings;
use KcPrintworks\AddressAutocomplete\Store;
use KcPrintworks\AddressAutocomplete\Usage;

/** An Admin whose redirect records the address instead of ending the request. */
final class TestAdmin extends Admin
{
    public ?string $redirected = null;

    protected function redirect(string $url): void
    {
        $this->redirected = $url;
    }
}

final class AdminTest extends TestCase
{
    private const KEY = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';

    private function admin(array $settings = [], ?array $forms = null): TestAdmin
    {
        \WpStub::$canManage = true;
        return new TestAdmin('/x/kcpw-address-autocomplete/kcpw-address-autocomplete.php', '0.1.0', new Store(Settings::load($settings), $forms ?? []));
    }

    public function testMenuAndHooksAreRegistered(): void
    {
        $this->admin()->register();
        foreach (['admin_menu', 'admin_enqueue_scripts', 'admin_post_kcpw_aa_save', 'admin_post_kcpw_aa_wizard'] as $hook) {
            $this->assertTrue(isset(\WpStub::$actions[$hook]), $hook);
        }
        \WpStub::run('admin_menu');
        $this->assertSame([['page', 'kcpw-aa'], ['sub', 'kcpw-aa'], ['sub', 'kcpw-aa-forms'], ['sub', 'kcpw-aa-settings']], \WpStub::$menus);
    }

    public function testAssetsLoadOnlyOnThePluginsOwnScreens(): void
    {
        $a = $this->admin(['browser_key' => self::KEY]);
        $a->assets('edit.php');
        $this->assertSame(0, count(\WpStub::$scripts));
        $a->assets('toplevel_page_kcpw-aa');
        $this->assertSame(['kcpw-aa-core', 'kcpw-aa-admin'], array_column(\WpStub::$scripts, 'handle'));
        $this->assertContains('KCPW_AA_MANUAL=true', \WpStub::$inline['kcpw-aa-core:before']);
        $this->assertNotContains('"picker"', \WpStub::$inline['kcpw-aa-admin:before'], 'the picker data is only for the form editor');
    }

    public function testTheFormsScreenGetsThePickerDataAndTheTokenOnlyThere(): void
    {
        \WpStub::$pages = [(object) ['ID' => 7, 'post_title' => 'Contact']];
        $a = $this->admin(['browser_key' => self::KEY]);
        $a->assets('address-autocomplete_page_kcpw-aa-forms');
        $js = \WpStub::$inline['kcpw-aa-admin:before'];
        $this->assertContains('"picker"', $js);
        $this->assertContains('nonce-kcpw_aa_pick', $js);
        $this->assertContains('Contact', $js);
        $this->assertContains('Use this selector', $js);
    }

    public function testDashboardShowsModeStepsUsageAndGoogleRequirements(): void
    {
        \WpStub::$options[Usage::OPTION] = Usage::record(null, ['r' => 12, 'd' => 3, 's' => 3, 'm' => 1, 'e' => ['quota' => 2]], gmdate('Y-m-d'));
        $html = $this->admin(['browser_key' => self::KEY])->dashboardHtml();
        $this->assertContains('Preview', $html);
        $this->assertContains('Customers see your checkout exactly as before', $html);
        $this->assertContains('Maps JavaScript API', $html);
        $this->assertContains('Places API (New)', $html);
        $this->assertContains('Geocoding API', $html);
        $this->assertContains('Address Validation API', $html);
        $this->assertContains('billing', strtolower($html));
        $this->assertContains('Powered by Google', $html);
        $this->assertContains('quota: 2', $html);
        $this->assertContains('>12<', $html);
        $this->assertContains('mapsplatform.google.com/pricing', $html);
        $this->assertContains('rel="noopener noreferrer"', $html);
    }

    public function testDashboardOffersTheCheckoutButtonOnlyUntilItExists(): void
    {
        $this->assertContains('Add the WooCommerce checkout (block)', $this->admin()->dashboardHtml());
        $forms = FormConfig::sanitizeList([FormConfig::blank('woo_block')]);
        $this->assertNotContains('Add the WooCommerce checkout (block)', $this->admin([], $forms)->dashboardHtml());
    }

    public function testTheWizardIsOfferedUntilItIsDone(): void
    {
        $this->assertContains('view=wizard', $this->admin()->dashboardHtml());
        $this->assertNotContains('view=wizard', $this->admin(['wizard_done' => true])->dashboardHtml());
    }

    public function testGoingLiveAsksForConfirmationAndOffersTheOtherModesOnly(): void
    {
        $html = $this->admin(['mode' => 'preview'])->dashboardHtml();
        $this->assertContains('data-confirm=', $html);
        $this->assertContains('Go live for customers', $html);
        $this->assertContains('Turn off', $html);
        $this->assertNotContains('Preview (administrators only)</button>', $html, 'the current mode has no button');
    }

    public function testOtherPluginsLoadingGoogleMapsAreShownWithoutTheirKeys(): void
    {
        \WpStub::$transients['kcpw_aa_conflicts'] = [['handle' => 'some-map-plugin', 'host' => 'maps.googleapis.com']];
        $html = $this->admin()->dashboardHtml();
        $this->assertContains('Another plugin loads Google Maps', $html);
        $this->assertContains('some-map-plugin', $html);
        $this->assertNotContains('key=', $html);
        \WpStub::$transients = [];
        $this->assertNotContains('Another plugin loads Google Maps', $this->admin()->dashboardHtml());
    }

    public function testASavedKeyIsNeverPrintedBack(): void
    {
        $a = $this->admin(['browser_key' => self::KEY, 'server_key' => 'ServerKeyServerKeyServerKey0123456789']);
        foreach ([$a->settingsHtml('general'), $a->dashboardHtml(), $a->settingsHtml('behavior')] as $html) {
            $this->assertNotContains(self::KEY, $html);
            $this->assertNotContains('AbCdEfGh', $html);
        }
        $this->assertContains('6789', $a->settingsHtml('general'), 'only the last four characters');
        $this->assertContains('Remove the saved key', $a->settingsHtml('general'));
        $assets = $this->admin(['browser_key' => self::KEY]);
        $assets->assets('toplevel_page_kcpw-aa');
        $this->assertContains(self::KEY, \WpStub::$inline['kcpw-aa-admin:before'], 'the key test needs it, for administrators only');
    }

    public function testEverySettingsFormCarriesItsOwnNonceAndSection(): void
    {
        $a = $this->admin();
        foreach (['general', 'behavior', 'style'] as $tab) {
            $html = $a->settingsHtml($tab);
            $this->assertContains('nonce-for-kcpw_aa_save_' . $tab, $html, $tab);
            $this->assertContains('name="section" value="' . $tab . '"', $html);
            $this->assertContains('name="action" value="kcpw_aa_save"', $html);
        }
        $this->assertContains('kcpw_aa_save_general', $a->settingsHtml('nonsense'), 'an unknown tab shows the first');
    }

    public function testSettingsFormsShowTheRealControls(): void
    {
        $a = $this->admin(['countries' => ['US', 'CA']]);
        $g = $a->settingsHtml('general');
        $this->assertContains('name="s[mode]"', $g);
        $this->assertContains('value="US, CA"', $g);
        $this->assertContains('Up to five', $g);
        $b = $a->settingsHtml('behavior');
        foreach (['s[min_chars]', 's[debounce_ms]', 's[max_requests]', 's[place_types]', 's[disable_autofill]', 's[show_fallback_notice]', 's[usage_counters]'] as $name) {
            $this->assertContains('name="' . $name . '"', $b, $name);
        }
        $this->assertContains('value="0"', $b, 'unticked boxes still post a 0');
        $this->assertContains('name="s[accent]"', $a->settingsHtml('style'));
    }

    public function testSavingRequiresTheCapabilityAndAValidNonce(): void
    {
        $a = $this->admin();
        \WpStub::$canManage = false;
        $this->assertThrows(fn () => $a->onSave(), '', 'a user without the capability is stopped');
        \WpStub::$canManage = true;
        $_POST = ['section' => 'general', 's' => ['mode' => 'live']];
        \WpStub::$nonceValid = false;
        $this->assertThrows(fn () => $a->onSave(), 'nonce');
        $this->assertSame([], \WpStub::$options, 'nothing was saved without a valid nonce');
    }

    public function testSavingAGeneralFormStoresOnlyThatSectionAndChecksTheMatchingNonce(): void
    {
        $a = $this->admin(['min_chars' => 5]);
        $_POST = ['section' => 'general', 's' => ['mode' => 'live', 'browser_key' => self::KEY, 'countries' => 'us, ca', 'min_chars' => '2']];
        $a->onSave();
        $saved = \WpStub::$options[Settings::OPTION];
        $this->assertSame('live', $saved['mode']);
        $this->assertSame(self::KEY, $saved['browser_key']);
        $this->assertSame(['US', 'CA'], $saved['countries']);
        $this->assertSame(5, $saved['min_chars'], 'the general form cannot change a behavior value');
        $this->assertSame(['kcpw_aa_save_general'], \WpStub::$nonceChecks);
        $this->assertSame(false, \WpStub::$autoload[Settings::OPTION], 'settings (with the key) are not autoloaded');
        $this->assertContains('page=kcpw-aa-settings&tab=general&kcpw_msg=saved', (string) $a->redirected);
    }

    public function testTheDashboardModeButtonsReturnToTheDashboard(): void
    {
        $a = $this->admin();
        $_POST = ['section' => 'general', 's' => ['mode' => 'off'], 'return' => 'dashboard'];
        $a->onSave();
        $this->assertSame('off', \WpStub::$options[Settings::OPTION]['mode']);
        $this->assertSame('https://shop.example.test/wp-admin/admin.php?page=kcpw-aa&kcpw_msg=saved', $a->redirected);
    }

    public function testAnUnknownSectionChangesNothing(): void
    {
        $a = $this->admin();
        $_POST = ['section' => 'evil', 's' => ['mode' => 'live']];
        $a->onSave();
        $this->assertSame([], \WpStub::$options);
        $this->assertContains('kcpw_msg=error', (string) $a->redirected);
    }

    public function testTheKeyTestStringsCoverEveryHint(): void
    {
        $s = Admin::adminStrings();
        foreach (['auth', 'script', 'api', 'quota', 'billing', 'network', 'conflict', 'unknown'] as $code) {
            $this->assertTrue(isset($s['hint_' . $code]) && $s['hint_' . $code] !== '', $code);
        }
    }

    public function testTheFeaturesAndPrivacyTabsRenderWithEverythingOffByDefault(): void
    {
        $a = $this->admin(['browser_key' => self::KEY]);
        $features = $a->settingsHtml('modules');
        $this->assertContains('name="s[modules][pobox]"', $features);
        $this->assertContains('name="s[modules][validation]"', $features);
        $this->assertContains('name="s[modules][gps]"', $features);
        $this->assertContains('name="s[modules][map_picker]"', $features);
        $this->assertContains('name="s[server_key]"', $features);
        $this->assertContains('name="s[validation_daily_cap]"', $features);
        $this->assertNotContains(' checked', preg_replace('/<input type="radio"[^>]*checked[^>]*>/', '', $features) ?? '', 'no feature starts switched on');
        $this->assertContains('form="kcpw-aa-test-server"', $features);
        $this->assertContains('value="kcpw_aa_test_server"', $features);
        $this->assertContains('nonce-for-kcpw_aa_test_server', $features);
        $this->assertContains('name="section" value="modules"', $features);

        $privacy = $a->settingsHtml('optins');
        foreach (['webhook][enabled', 'webhook][consent', 'webhook][url', 'webhook][include_address', 'abandonment][enabled', 'ip][enabled', 'ip][service_url'] as $field) {
            $this->assertContains('s[optins][' . $field . ']', $privacy, $field);
        }
        $this->assertSame(0, preg_match('/<input type="checkbox"[^>]*name="s\[optins\]\[(?:webhook\]\[(?:enabled|consent|include_address)|abandonment\]\[enabled|ip\]\[enabled)\]"[^>]*checked/', $privacy), 'nothing starts switched on');
        $this->assertContains('Currently off.', $privacy);
        $this->assertContains('name="section" value="optins"', $privacy);
    }

    public function testAKeySavedForTheServerIsNeverPrintedBack(): void
    {
        $a = $this->admin(['server_key' => 'ServerKeyServerKeyServerKey0123456789']);
        $html = $a->settingsHtml('modules');
        $this->assertNotContains('ServerKeyServerKey', $html);
        $this->assertContains('6789', $html, 'only the last four characters');
        $this->assertContains('name="s[clear_server_key]"', $html);
    }

    public function testSavingTheFeaturesTabStoresTheSwitchesAndTheKey(): void
    {
        $a = $this->admin();
        $_POST = ['section' => 'modules', '_wpnonce' => 'x', 's' => ['modules' => ['pobox' => '1', 'validation' => '1', 'gps' => '0'], 'pobox_mode' => 'block', 'server_key' => 'ServerKeyServerKeyServerKey0123456789', 'validation_daily_cap' => '75']];
        $a->onSave();
        $saved = \WpStub::$options[Settings::OPTION];
        $this->assertSame(true, $saved['modules']['pobox']);
        $this->assertSame(true, $saved['modules']['validation']);
        $this->assertSame(false, $saved['modules']['gps']);
        $this->assertSame('block', $saved['pobox_mode']);
        $this->assertSame(75, $saved['validation_daily_cap']);
        $this->assertSame('ServerKeyServerKeyServerKey0123456789', $saved['server_key']);
        $this->assertSame(false, \WpStub::$autoload[Settings::OPTION], 'the key is never autoloaded');
        $this->assertContains('tab=modules', (string) $a->redirected);
        $this->assertContains('kcpw_aa_save_modules', implode(',', \WpStub::$nonceChecks));
    }

    public function testSavingThePrivacyTabNeedsConsentBeforeAWebhookIsOn(): void
    {
        $a = $this->admin();
        $_POST = ['section' => 'optins', '_wpnonce' => 'x', 's' => ['optins' => ['webhook' => ['enabled' => '1', 'consent' => '0', 'url' => 'https://hooks.example.test/in', 'events' => ['', 'bad']], 'abandonment' => ['enabled' => '1'], 'ip' => ['enabled' => '0']]]];
        $a->onSave();
        $o = \WpStub::$options[Settings::OPTION]['optins'];
        $this->assertSame(false, $o['webhook']['enabled'], 'no consent, no webhook');
        $this->assertSame(['bad'], $o['webhook']['events']);
        $this->assertSame(true, $o['abandonment']['enabled']);
        $this->assertSame(false, $o['ip']['enabled']);

        $_POST['s']['optins']['webhook']['consent'] = '1';
        $a->onSave();
        $this->assertSame(true, \WpStub::$options[Settings::OPTION]['optins']['webhook']['enabled']);
        $_POST['s']['optins']['webhook']['url'] = 'http://insecure.example.test/in';
        $a->onSave();
        $this->assertSame(false, \WpStub::$options[Settings::OPTION]['optins']['webhook']['enabled'], 'an http address turns it off again');
        $_POST['s']['optins']['webhook']['events'] = [''];
        $a->onSave();
        $this->assertSame([], \WpStub::$options[Settings::OPTION]['optins']['webhook']['events'], 'every box unticked means none');
    }

    public function testTheServerKeyTestReportsInPlainWordsAndNeedsAnAdministratorAndANonce(): void
    {
        $ok = new FakeHttp(['status' => 200, 'body' => '{"result":{"verdict":{"addressComplete":true,"validationGranularity":"PREMISE"}}}']);
        $make = function (array $settings, FakeHttp $http): TestAdmin {
            \WpStub::$canManage = true;
            return new TestAdmin('/x/kcpw-address-autocomplete/kcpw-address-autocomplete.php', '0.1.0', new Store(Settings::load($settings), []), $http);
        };
        $a = $make(['server_key' => 'ServerKeyServerKeyServerKey0123456789'], $ok);
        $a->onTestServer();
        $this->assertContains('kcpw_msg=server_ok', (string) $a->redirected);
        $this->assertSame(1, count($ok->calls));
        $this->assertContains('kcpw_aa_test_server', implode(',', \WpStub::$nonceChecks));
        $this->assertNotContains('ServerKey', (string) $a->redirected, 'the key never goes in an address');

        $none = new FakeHttp();
        $b = $make([], $none);
        $b->onTestServer();
        $this->assertContains('kcpw_msg=server_nokey', (string) $b->redirected);
        $this->assertSame(0, count($none->calls), 'no key, no request');

        foreach ([[403, '{"error":{"status":"PERMISSION_DENIED"}}', 'server_api'], [429, '', 'server_quota'], [400, '{"error":{"message":"API key not valid"}}', 'server_auth'], [500, '', 'server_other']] as [$status, $body, $expected]) {
            $c = $make(['server_key' => 'ServerKeyServerKeyServerKey0123456789'], new FakeHttp(['status' => $status, 'body' => $body]));
            $c->onTestServer();
            $this->assertContains('kcpw_msg=' . $expected, (string) $c->redirected, (string) $status);
        }
        $d = $make(['server_key' => 'ServerKeyServerKeyServerKey0123456789'], new FakeHttp(null));
        $d->onTestServer();
        $this->assertContains('kcpw_msg=server_network', (string) $d->redirected);

        \WpStub::$canManage = false;
        $e = new TestAdmin('/x/kcpw-address-autocomplete/kcpw-address-autocomplete.php', '0.1.0', new Store(Settings::load(['server_key' => 'ServerKeyServerKeyServerKey0123456789']), []), new FakeHttp());
        $this->assertThrows(fn () => $e->onTestServer(), 'permission');
        \WpStub::$canManage = true;
        \WpStub::$nonceValid = false;
        $this->assertThrows(fn () => $make(['server_key' => 'ServerKeyServerKeyServerKey0123456789'], new FakeHttp())->onTestServer(), 'nonce');
    }

    public function testTheDashboardShowsOnlyTheFeaturesThatAreOnAndWhatTheyStillNeed(): void
    {
        $this->assertSame('', $this->admin()->featuresStatusHtml(), 'nothing switched on, nothing shown');
        $html = $this->admin(['modules' => ['validation' => true, 'gps' => true]])->featuresStatusHtml();
        $this->assertContains('Address check', $html);
        $this->assertContains('needs a server key', $html);
        $this->assertContains('Use my location', $html);
        $this->assertNotContains('Choose on a map', $html);
        $on = $this->admin(['server_key' => 'ServerKeyServerKeyServerKey0123456789', 'modules' => ['validation' => true]])->featuresStatusHtml();
        $this->assertNotContains('needs a server key', $on);
    }

    public function testUsageShowsTheServerCountersOnlyForTheFeaturesThatAreOn(): void
    {
        \WpStub::$options[Usage::OPTION] = Usage::bump(Usage::bump(Usage::bump(null, ['v' => 3], gmdate('Y-m-d')), ['cs' => 7], gmdate('Y-m-d')), ['cc' => 4], gmdate('Y-m-d'));
        $plain = $this->admin()->usageHtml();
        $this->assertNotContains('Address checks asked', $plain);
        $this->assertNotContains('Checkouts started', $plain);
        $on = $this->admin(['modules' => ['validation' => true], 'optins' => ['abandonment' => ['enabled' => true]]])->usageHtml();
        $this->assertContains('Address checks asked', $on);
        $this->assertContains('Checkouts started', $on);
        $this->assertContains('Orders completed', $on);
    }
}
