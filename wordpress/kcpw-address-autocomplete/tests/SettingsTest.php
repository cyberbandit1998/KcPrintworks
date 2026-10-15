<?php
declare(strict_types=1);

namespace KcPrintworks\AddressAutocomplete\Tests;

use KcPrintworks\AddressAutocomplete\Settings;

final class SettingsTest extends TestCase
{
    private const KEY = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';

    public function testSafeDefaults(): void
    {
        $d = Settings::defaults();
        $this->assertSame(Settings::MODE_PREVIEW, $d['mode'], 'starts in the administrators-only preview');
        $this->assertSame('', $d['browser_key']);
        $this->assertSame(['map_picker' => false, 'gps' => false, 'validation' => false, 'pobox' => false], $d['modules'], 'every optional module is off');
        $this->assertFalse($d['optins']['webhook']['enabled']);
        $this->assertFalse($d['optins']['abandonment']['enabled']);
        $this->assertFalse($d['optins']['ip']['enabled']);
        $this->assertFalse($d['optins']['webhook']['include_address'], 'a webhook never carries an address unless asked');
        $this->assertSame(3, $d['min_chars']);
        $this->assertSame(300, $d['debounce_ms']);
    }

    public function testLoadForcesEveryValueIntoRange(): void
    {
        $s = Settings::load(['mode' => 'banana', 'min_chars' => 99, 'debounce_ms' => 1, 'max_requests' => 'lots', 'theme' => '<script>', 'radius' => 500, 'accent' => 'red']);
        $this->assertSame(Settings::MODE_PREVIEW, $s['mode']);
        $this->assertSame(6, $s['min_chars']);
        $this->assertSame(200, $s['debounce_ms']);
        $this->assertSame(12, $s['max_requests']);
        $this->assertSame('match', $s['theme']);
        $this->assertSame(24, $s['radius']);
        $this->assertSame('#2b59e6', $s['accent']);
        $this->assertSame(Settings::defaults(), Settings::load(null));
        $this->assertSame(Settings::defaults(), Settings::load('nonsense'));
    }

    public function testApiKeyOnlyTakesGoogleShapedKeys(): void
    {
        $this->assertSame(self::KEY, Settings::apiKey("  " . self::KEY . "\n"));
        $this->assertSame('', Settings::apiKey('short'));
        $this->assertSame('old', Settings::apiKey('has space and <b>tags</b> in it, not a key', 'old'));
        $this->assertSame('', Settings::apiKey(str_repeat('A', 200)));
    }

    public function testBlankKeyKeepsTheSavedOneAndTheTickRemovesIt(): void
    {
        $current = Settings::applySection(Settings::defaults(), ['browser_key' => self::KEY], 'general');
        $this->assertSame(self::KEY, $current['browser_key']);
        $kept = Settings::applySection($current, ['browser_key' => ''], 'general');
        $this->assertSame(self::KEY, $kept['browser_key'], 'an empty field is "no change", because the page never prints the key back');
        $bad = Settings::applySection($current, ['browser_key' => 'garbage'], 'general');
        $this->assertSame(self::KEY, $bad['browser_key'], 'a malformed key never replaces a good one');
        $cleared = Settings::applySection($current, ['browser_key' => '', 'clear_browser_key' => '1'], 'general');
        $this->assertSame('', $cleared['browser_key']);
    }

    public function testMaskShowsOnlyTheLastFour(): void
    {
        $masked = Settings::maskKey(self::KEY);
        $this->assertContains('6789', $masked);
        $this->assertNotContains('AbCd', $masked);
        $this->assertSame('', Settings::maskKey(''));
    }

    public function testCountriesAreCappedAtFiveUniqueUpperCaseCodes(): void
    {
        $this->assertSame(['US', 'CA', 'GB'], Settings::countries('us, ca; gb us'));
        $this->assertSame(['US', 'CA', 'GB', 'AU', 'NZ'], Settings::countries('us ca gb au nz ie de fr'));
        $this->assertSame([], Settings::countries('USA, 12, , x'));
        $this->assertSame(['US'], Settings::countries(['us', ['nested'], null, 'u$']));
        $this->assertSame([], Settings::countries(42));
    }

    public function testLanguageIsAnIdentifierOrEmpty(): void
    {
        $this->assertSame('en', Settings::language('en'));
        $this->assertSame('pt-BR', Settings::language('pt-BR'));
        $this->assertSame('', Settings::language('en_US'));
        $this->assertSame('', Settings::language('<script>'));
    }

    public function testSectionsOnlyTouchTheirOwnFields(): void
    {
        $base = Settings::applySection(Settings::defaults(), ['browser_key' => self::KEY, 'countries' => 'US'], 'general');
        $after = Settings::applySection($base, ['min_chars' => '4', 'mode' => 'live', 'browser_key' => 'zzz', 'countries' => 'FR'], 'behavior');
        $this->assertSame(4, $after['min_chars']);
        $this->assertSame(Settings::MODE_PREVIEW, $after['mode'], 'the behavior form cannot change the mode');
        $this->assertSame(self::KEY, $after['browser_key']);
        $this->assertSame(['US'], $after['countries']);
    }

    public function testUncheckedBoxesArriveAsZeroAndTurnTheOptionOff(): void
    {
        $on = Settings::applySection(Settings::defaults(), ['disable_autofill' => '1', 'usage_counters' => '1'], 'behavior');
        $this->assertTrue($on['disable_autofill']);
        $off = Settings::applySection($on, ['disable_autofill' => '0', 'usage_counters' => '0', 'show_fallback_notice' => '0'], 'behavior');
        $this->assertFalse($off['disable_autofill']);
        $this->assertFalse($off['usage_counters']);
        $this->assertFalse($off['show_fallback_notice']);
    }

    public function testStyleAcceptsOnlyHexColorsSoNothingElseReachesAStyleRule(): void
    {
        $s = Settings::applySection(Settings::defaults(), ['accent' => 'red;}</style><script>', 'theme' => 'dark', 'radius' => '12'], 'style');
        $this->assertSame('#2b59e6', $s['accent']);
        $this->assertSame('dark', $s['theme']);
        $this->assertSame(12, $s['radius']);
        $this->assertSame('#abc', Settings::applySection(Settings::defaults(), ['accent' => '#ABC'], 'style')['accent']);
    }

    public function testModuleSwitchesAreBooleansAndUnknownModulesAreIgnored(): void
    {
        $s = Settings::applySection(Settings::defaults(), ['modules' => ['map_picker' => '1', 'gps' => 'yes', 'evil' => '1'], 'pobox_mode' => 'block', 'map_id' => 'bad id!'], 'modules');
        $this->assertTrue($s['modules']['map_picker']);
        $this->assertFalse($s['modules']['gps'], '"yes" is not a switch value');
        $this->assertFalse(isset($s['modules']['evil']));
        $this->assertSame('block', $s['pobox_mode']);
        $this->assertSame('DEMO_MAP_ID', $s['map_id']);
    }

    public function testWebhookNeedsConsentAndAnHttpsAddressToTurnOn(): void
    {
        $url = 'https://hooks.example.test/in/abc';
        $s = Settings::applySection(Settings::defaults(), ['optins' => ['webhook' => ['enabled' => '1', 'url' => $url]]], 'optins');
        $this->assertFalse($s['optins']['webhook']['enabled'], 'no consent tick, so it stays off');
        $s = Settings::applySection($s, ['optins' => ['webhook' => ['enabled' => '1', 'consent' => '1', 'url' => 'http://insecure.example.test/x']]], 'optins');
        $this->assertFalse($s['optins']['webhook']['enabled'], 'http is refused');
        $this->assertSame('', $s['optins']['webhook']['url']);
        $s = Settings::applySection($s, ['optins' => ['webhook' => ['enabled' => '1', 'consent' => '1', 'url' => $url]]], 'optins');
        $this->assertTrue($s['optins']['webhook']['enabled']);
        $this->assertTrue(Settings::optInEnabled($s, 'webhook'));
        $s = Settings::applySection($s, ['optins' => ['webhook' => ['consent' => '0']]], 'optins');
        $this->assertFalse($s['optins']['webhook']['enabled'], 'withdrawing consent switches it off');
        $this->assertFalse(Settings::optInEnabled($s, 'webhook'));
    }

    public function testWebhookAddressIsStrict(): void
    {
        foreach (['https://user:pw@hooks.example.test/x', 'https:///nohost', 'ftp://x.test/a', 'https://a.test/<script>', 'javascript:alert(1)', str_repeat('a', 600)] as $bad) {
            $this->assertSame('', Settings::webhookUrl($bad), $bad);
        }
        $this->assertSame('https://hooks.slack.test/services/T0/B0/xyz', Settings::webhookUrl('https://hooks.slack.test/services/T0/B0/xyz'));
    }

    public function testWebhookEventsAreFromAKnownList(): void
    {
        $s = Settings::applySection(Settings::defaults(), ['optins' => ['webhook' => ['events' => ['bad', 'check', 'drop table', 'pobox']]]], 'optins');
        $this->assertSame(['bad', 'check', 'pobox'], $s['optins']['webhook']['events']);
    }

    public function testIpLocationIsOptInAndTheExternalServiceNeedsAnHttpsAddressWithTheIpMarker(): void
    {
        $this->assertFalse(Settings::optInEnabled(Settings::defaults(), 'ip'));
        $s = Settings::applySection(Settings::defaults(), ['optins' => ['ip' => ['enabled' => '1', 'source' => 'service', 'service_url' => 'https://ip.example.test/json/{ip}']]], 'optins');
        $this->assertTrue(Settings::optInEnabled($s, 'ip'));
        $this->assertSame('service', $s['optins']['ip']['source']);
        $s = Settings::applySection($s, ['optins' => ['ip' => ['service_url' => 'https://ip.example.test/json/']]], 'optins');
        $this->assertSame('', $s['optins']['ip']['service_url'], 'an address with no {ip} marker is useless');
        $this->assertSame('header', $s['optins']['ip']['source'], 'with no usable service it falls back to the header, which makes no outside call');
    }

    public function testAbandonmentIsOffUntilSwitchedOn(): void
    {
        $this->assertFalse(Settings::optInEnabled(Settings::defaults(), 'abandonment'));
        $s = Settings::applySection(Settings::defaults(), ['optins' => ['abandonment' => ['enabled' => '1']]], 'optins');
        $this->assertTrue(Settings::optInEnabled($s, 'abandonment'));
        $this->assertFalse(Settings::optInEnabled($s, 'nope'));
    }

    public function testActivationGates(): void
    {
        $withKey = fn (string $mode): array => ['mode' => $mode, 'browser_key' => self::KEY];
        $this->assertFalse(Settings::isActiveFor($withKey('off'), true));
        $this->assertTrue(Settings::isActiveFor($withKey('preview'), true), 'an administrator sees the preview');
        $this->assertFalse(Settings::isActiveFor($withKey('preview'), false), 'a customer does not');
        $this->assertTrue(Settings::isActiveFor($withKey('live'), false));
        $this->assertFalse(Settings::isActiveFor(['mode' => 'live', 'browser_key' => ''], true), 'no key, nothing loads');
        $this->assertFalse(Settings::isActiveFor(['mode' => 'live', 'browser_key' => '   '], true));
        $this->assertFalse(Settings::isActiveFor(['mode' => 'weird', 'browser_key' => self::KEY], true));
    }

    public function testAConstantInWpConfigOverridesWithoutBeingSavedBack(): void
    {
        $stored = Settings::applySection(Settings::defaults(), ['browser_key' => self::KEY], 'general');
        $other = 'ZyXwVuTsRqPoNmLkJiHgFeDcBa9876543210';
        $effective = Settings::effective($stored, $other, null);
        $this->assertSame($other, $effective['browser_key']);
        $this->assertSame(self::KEY, $stored['browser_key'], 'the stored settings are untouched');
        $this->assertSame(self::KEY, Settings::effective($stored, 'not a key', null)['browser_key'], 'a malformed constant is ignored');
        $this->assertSame('', Settings::effective($stored, null, null)['server_key']);
    }

    public function testHostileInputNeverThrows(): void
    {
        foreach (Settings::SECTIONS as $section) {
            $out = Settings::applySection(Settings::defaults(), [
                'mode' => ['x'], 'browser_key' => ['x'], 'countries' => new \stdClass(), 'language' => 5, 'min_chars' => [], 'theme' => null,
                'modules' => 'nope', 'optins' => 'nope', 'accent' => ['#fff'], 'place_types' => ['address'],
            ], $section);
            $this->assertSame(Settings::defaults()['mode'], $out['mode']);
        }
    }
}
