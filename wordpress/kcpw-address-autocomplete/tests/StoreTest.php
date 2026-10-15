<?php
declare(strict_types=1);

namespace KcPrintworks\AddressAutocomplete\Tests;

use KcPrintworks\AddressAutocomplete\FormConfig;
use KcPrintworks\AddressAutocomplete\Settings;
use KcPrintworks\AddressAutocomplete\Store;

final class StoreTest extends TestCase
{
    public function testLoadReadsAndSanitizesWhatIsStored(): void
    {
        \WpStub::$options['kcpw_aa_settings'] = ['mode' => 'hacked', 'min_chars' => 999];
        \WpStub::$options['kcpw_aa_forms'] = [['groups' => []], 'junk', FormConfig::blank('woo_block')];
        $s = Store::load();
        $this->assertSame('preview', $s->settings['mode']);
        $this->assertSame(6, $s->settings['min_chars']);
        $this->assertSame(1, count($s->forms), 'only the usable form is kept');
    }

    public function testSavingWritesSanitizedValuesWithoutAutoload(): void
    {
        $s = new Store(Settings::defaults(), []);
        $s->saveSettings(['mode' => 'live', 'min_chars' => 50] + Settings::defaults());
        $this->assertSame('live', \WpStub::$options['kcpw_aa_settings']['mode']);
        $this->assertSame(6, \WpStub::$options['kcpw_aa_settings']['min_chars']);
        $this->assertSame(false, \WpStub::$autoload['kcpw_aa_settings']);
        $s->saveForms([FormConfig::blank('woo_block'), ['not' => 'a form']]);
        $this->assertSame(1, count(\WpStub::$options['kcpw_aa_forms']));
        $this->assertSame(false, \WpStub::$autoload['kcpw_aa_forms']);
    }

    public function testFormLookupByIdAndEffectiveKeys(): void
    {
        $form = FormConfig::sanitize(['id' => 'f_lookup01'] + FormConfig::blank('woo_block'));
        $s = new Store(Settings::applySection(Settings::defaults(), ['browser_key' => 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789'], 'general'), [$form]);
        $this->assertSame('f_lookup01', $s->form('f_lookup01')['id']);
        $this->assertSame(null, $s->form('f_nope'));
        $this->assertSame('AbCdEfGhIjKlMnOpQrStUvWxYz0123456789', $s->effective()['browser_key']);
    }
}
