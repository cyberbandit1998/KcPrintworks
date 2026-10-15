<?php
declare(strict_types=1);

namespace KcPrintworks\AddressAutocomplete\Tests;

/** The decision-making classes must not call WordPress, so every rule stays testable without it. */
final class PurityTest extends TestCase
{
    private const PURE = ['Settings', 'Presets', 'FormConfig', 'PageMatcher', 'Usage', 'RateLimiter'];

    public function testPureClassesCallNoWordPressFunctions(): void
    {
        foreach (self::PURE as $class) {
            $code = (string) file_get_contents(dirname(__DIR__) . "/src/$class.php");
            $code = (string) preg_replace('#/\*.*?\*/#s', '', $code);
            $code = (string) preg_replace('#//[^\n]*#', '', $code);
            $this->assertSame(0, preg_match('/\b(?:wp_[a-z_]+|get_option|update_option|add_action|add_filter|esc_[a-z]+|sanitize_[a-z_]+|__|_e|apply_filters|do_action|is_admin|current_user_can|home_url|admin_url|get_transient|set_transient)\s*\(/', $code, $m), $class . ' calls ' . ($m[0] ?? ''));
        }
    }

    public function testNoFileHoldsASecretShapedString(): void
    {
        $root = dirname(__DIR__);
        $files = array_merge(glob($root . '/src/*.php') ?: [], glob($root . '/assets/js/*.js') ?: [], [$root . '/kcpw-address-autocomplete.php']);
        foreach ($files as $file) {
            $this->assertSame(0, preg_match('/AIza[0-9A-Za-z_\-]{30,}/', (string) file_get_contents($file)), basename($file) . ' holds something shaped like a Google key');
        }
    }

    public function testThePluginFileLoadsEveryClassItNeeds(): void
    {
        $main = (string) file_get_contents(dirname(__DIR__) . '/kcpw-address-autocomplete.php');
        foreach (glob(dirname(__DIR__) . '/src/*.php') ?: [] as $file) {
            $this->assertContains("'" . basename($file, '.php') . "'", $main, basename($file) . ' is not required by the plugin file');
        }
        $this->assertContains('Requires PHP:      8.1', $main);
        $this->assertContains('GPL-2.0-or-later', $main);
        $this->assertContains("if (!defined('ABSPATH'))", $main);
    }

    public function testUninstallRemovesEverythingTheEarlierStagesStore(): void
    {
        $u = (string) file_get_contents(dirname(__DIR__) . '/uninstall.php');
        foreach (['kcpw_aa_settings', 'kcpw_aa_forms', 'kcpw_aa_usage'] as $option) {
            $this->assertContains($option, $u);
        }
        $this->assertContains("defined('WP_UNINSTALL_PLUGIN')", $u);
        $this->assertContains('_transient_kcpw_aa_', $u, 'the short-lived markers are cleared too');
        $this->assertContains('kcpw_aa_conflicts', $u);
    }
}
