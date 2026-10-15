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
}
