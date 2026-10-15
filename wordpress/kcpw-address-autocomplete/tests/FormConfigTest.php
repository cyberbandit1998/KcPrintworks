<?php
declare(strict_types=1);

namespace KcPrintworks\AddressAutocomplete\Tests;

use KcPrintworks\AddressAutocomplete\FormConfig;
use KcPrintworks\AddressAutocomplete\Presets;
use KcPrintworks\AddressAutocomplete\Settings;

final class FormConfigTest extends TestCase
{
    public function testEveryPresetWithSelectorsSurvivesSanitizing(): void
    {
        foreach (Presets::all() as $key => $preset) {
            $form = FormConfig::blank($key);
            $clean = FormConfig::sanitize($form);
            if ($key === 'custom') {
                $this->assertSame(null, $clean, 'a blank custom form has no address selector yet and cannot be saved');
                continue;
            }
            $this->assertTrue($clean !== null, $key);
            $this->assertSame($form['groups'][0]['fields']['address'], $clean['groups'][0]['fields']['address'], $key);
            foreach ($clean['groups'] as $group) {
                foreach (Presets::FIELDS as $field) {
                    $this->assertTrue(array_key_exists($field, $group['fields']), "$key has $field");
                }
            }
        }
    }

    public function testTheWooCommerceBlockPresetUsesTheBlocksOwnIds(): void
    {
        $groups = Presets::all()['woo_block']['groups'];
        $this->assertSame('#shipping-address_1', $groups[0]['fields']['address']);
        $this->assertSame('#shipping-state', $groups[0]['fields']['state']);
        $this->assertSame('#shipping-postcode', $groups[0]['fields']['postcode']);
        $this->assertSame('#billing-country', $groups[1]['fields']['country']);
        $classic = Presets::all()['woo_classic']['groups'];
        $this->assertSame('#billing_address_1', $classic[0]['fields']['address']);
        $this->assertSame('#shipping_postcode', $classic[1]['fields']['postcode']);
        $this->assertSame('checkout', Presets::all()['woo_block']['pages']['mode']);
        $this->assertTrue(Presets::all()['woo_classic']['pages']['account_address']);
    }

    public function testAGroupWithoutAnAddressSelectorIsDropped(): void
    {
        $this->assertSame(null, FormConfig::sanitize(['name' => 'x', 'groups' => [['label' => 'a', 'fields' => ['city' => '#c']]]]));
        $this->assertSame(null, FormConfig::sanitize('not an array'));
        $this->assertSame(null, FormConfig::sanitize(['groups' => 'nope']));
    }

    public function testSelectorsAreCleanedAndLimited(): void
    {
        $this->assertSame('#a b', FormConfig::selector("#a\n\tb"));
        $this->assertSame('', FormConfig::selector(str_repeat('a', 301)));
        $this->assertSame('div .x', FormConfig::selector('div <.x'));
        $this->assertSame('form > input[name="a"]', FormConfig::selector('form > input[name="a"]'), 'the child combinator written by the Visual Selector Tool survives');
        $this->assertSame('', FormConfig::selector(['x']));
    }

    public function testStoredValuesAreAllowListed(): void
    {
        $f = FormConfig::sanitize([
            'id' => 'f_abcd1234', 'name' => '<b>Checkout</b> ' . str_repeat('x', 200), 'preset' => 'evil', 'mode' => 'both',
            'groups' => [['label' => 'G', 'scope' => 'form', 'fields' => ['address' => '#a', 'city' => '#c', 'evil' => '#x']]],
            'pages' => ['mode' => 'nowhere', 'ids' => [3, '4', 'x', -1, 3], 'paths' => "/a/\nhttp://x\n/b/*", 'account_address' => '1'],
            'countries' => 'us, ca, gb, au, nz, de', 'language' => 'en_US', 'place_types' => 'weird', 'features' => ['gps' => '0', 'pobox' => '1'],
            'extra' => 'dropped',
        ]);
        $this->assertSame('f_abcd1234', $f['id']);
        $this->assertTrue(strlen($f['name']) <= 80 && !str_contains($f['name'], '<'));
        $this->assertSame('custom', $f['preset']);
        $this->assertSame('smart', $f['mode']);
        $this->assertSame(['address', 'address2', 'city', 'state', 'postcode', 'country'], array_keys($f['groups'][0]['fields']));
        $this->assertSame('selected', $f['pages']['mode']);
        $this->assertSame([3, 4], $f['pages']['ids']);
        $this->assertSame(['/a/', '/b/*'], $f['pages']['paths']);
        $this->assertTrue($f['pages']['account_address']);
        $this->assertSame(['US', 'CA', 'GB', 'AU', 'NZ'], $f['countries']);
        $this->assertSame('', $f['language']);
        $this->assertSame('', $f['place_types']);
        $this->assertFalse($f['features']['gps']);
        $this->assertTrue($f['features']['pobox']);
        $this->assertFalse(isset($f['extra']));
    }

    public function testListIsCappedAndIdsStayUnique(): void
    {
        $one = FormConfig::blank('woo_block');
        $list = FormConfig::sanitizeList([$one, $one, $one]);
        $this->assertSame(3, count($list));
        $this->assertSame(3, count(array_unique(array_column($list, 'id'))), 'a repeated id is replaced');
        $many = array_fill(0, 40, FormConfig::blank('woo_block'));
        $this->assertSame(FormConfig::MAX_FORMS, count(FormConfig::sanitizeList($many)));
        $this->assertSame([], FormConfig::sanitizeList('nope'));
    }

    public function testDuplicateGetsANewIdAndACopyName(): void
    {
        $form = FormConfig::blank('woo_block');
        $copy = FormConfig::duplicate($form);
        $this->assertTrue($copy['id'] !== $form['id']);
        $this->assertContains('(copy)', $copy['name']);
        $this->assertSame($form['groups'], $copy['groups']);
    }

    public function testExportImportRoundTripGivesFreshIdsAndRefusesForeignFiles(): void
    {
        $forms = FormConfig::sanitizeList([FormConfig::blank('woo_block'), FormConfig::blank('wpforms')]);
        $json = FormConfig::export($forms);
        $this->assertNotContains('key', strtolower(str_replace('keyword', '', $json)), 'an export never holds a key');
        $imported = FormConfig::import($json);
        $this->assertSame(2, count($imported));
        $this->assertSame($forms[0]['groups'], $imported[0]['groups']);
        $this->assertTrue($imported[0]['id'] !== $forms[0]['id'], 'an import can never overwrite an existing form');
        $this->assertSame(null, FormConfig::import('{"forms":[]}'));
        $this->assertSame(null, FormConfig::import('not json'));
        $this->assertSame(null, FormConfig::import(str_repeat('x', 500000)));
        $this->assertSame(null, FormConfig::import('{"kcpw_address_autocomplete":2,"forms":[]}'));
    }

    public function testBrowserCopyFillsDefaultsAndGatesFeaturesByTheGlobalModuleSwitch(): void
    {
        $form = FormConfig::sanitize(FormConfig::blank('woo_block'));
        $settings = Settings::applySection(Settings::defaults(), ['countries' => 'US,CA', 'language' => 'en', 'modules' => ['gps' => '1']], 'general');
        $settings = Settings::applySection($settings, ['modules' => ['gps' => '1']], 'modules');
        $b = FormConfig::forBrowser($form, $settings);
        $this->assertSame(['US', 'CA'], $b['countries']);
        $this->assertSame('en', $b['language']);
        $this->assertSame('address', $b['placeTypes']);
        $this->assertTrue($b['features']['gps'], 'on globally and on for the form');
        $this->assertFalse($b['features']['map_picker'], 'off globally, so off here even though the form allows it');
        $form['features']['gps'] = false;
        $this->assertFalse(FormConfig::forBrowser($form, $settings)['features']['gps'], 'off for the form');
        $own = $form;
        $own['countries'] = ['FR'];
        $this->assertSame(['FR'], FormConfig::forBrowser($own, $settings)['countries'], 'a form can override the countries');
    }

    public function testBrowserCopyHoldsNoKeyOrSetting(): void
    {
        $settings = Settings::applySection(Settings::defaults(), ['browser_key' => 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789'], 'general');
        $json = (string) json_encode(FormConfig::forBrowser(FormConfig::sanitize(FormConfig::blank('woo_block')), $settings));
        $this->assertNotContains('AbCdEf', $json);
        $this->assertNotContains('server_key', $json);
    }
}
