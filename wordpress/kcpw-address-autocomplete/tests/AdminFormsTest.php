<?php
declare(strict_types=1);

namespace KcPrintworks\AddressAutocomplete\Tests;

use KcPrintworks\AddressAutocomplete\AdminForms;
use KcPrintworks\AddressAutocomplete\FormConfig;
use KcPrintworks\AddressAutocomplete\Presets;
use KcPrintworks\AddressAutocomplete\Settings;
use KcPrintworks\AddressAutocomplete\Store;

/** AdminForms whose redirect and download are recorded instead of ending the request. */
final class TestAdminForms extends AdminForms
{
    public ?string $redirected = null;
    public ?string $sent = null;
    public ?string $filename = null;

    protected function redirect(string $url): void
    {
        $this->redirected = $url;
    }

    protected function send(string $body, string $filename): void
    {
        $this->sent = $body;
        $this->filename = $filename;
    }
}

final class AdminFormsTest extends TestCase
{
    private function screen(array $forms = [], array $settings = []): TestAdminForms
    {
        \WpStub::$canManage = true;
        return new TestAdminForms(new Store(Settings::load($settings), FormConfig::sanitizeList($forms)));
    }

    private function woo(): array
    {
        return FormConfig::blank('woo_block');
    }

    public function testHooksAreRegistered(): void
    {
        $this->screen()->register();
        foreach (['admin_post_kcpw_aa_forms', 'admin_post_kcpw_aa_form_save', 'admin_post_kcpw_aa_export', 'admin_post_kcpw_aa_import'] as $hook) {
            $this->assertTrue(isset(\WpStub::$actions[$hook]), $hook);
        }
    }

    public function testTheListShowsEveryFormWithItsActionsAndEveryPreset(): void
    {
        $html = $this->screen([$this->woo()])->listHtml();
        $this->assertContains('WooCommerce Checkout Block', $html);
        $this->assertContains('The WooCommerce checkout page', $html);
        foreach (['Turn off', 'Duplicate', 'Delete', 'Edit'] as $action) {
            $this->assertContains($action, $html, $action);
        }
        foreach (Presets::all() as $key => $preset) {
            $this->assertContains($preset['label'], $html, $key);
        }
        $this->assertContains('page=kcpw-aa-forms&amp;new=custom', $html, 'a custom form is set up in the editor, not added blind');
        $this->assertContains('nonce-for-kcpw_aa_forms', $html);
        $this->assertContains('nonce-for-kcpw_aa_import', $html);
        $this->assertContains('_wpnonce=nonce-for-kcpw_aa_export', $html, 'the download link carries its own nonce');
        $this->assertContains('never a Google key', $html);
    }

    public function testTheEditorHasEveryFieldAPickButtonAndASpareSet(): void
    {
        $form = FormConfig::sanitize($this->woo());
        $html = $this->screen([$form])->editorHtml($form, false);
        $this->assertContains('name="f[name]"', $html);
        $this->assertContains('name="f[mode]"', $html);
        $this->assertContains('name="f[groups][0][fields][address]" id="kcpw-aa-g0-address" value="#shipping-address_1"', $html);
        $this->assertContains('name="f[groups][1][fields][postcode]" id="kcpw-aa-g1-postcode" value="#billing-postcode"', $html);
        $this->assertContains('name="f[groups][2][fields][address]"', $html, 'a spare, empty set so another address can be added');
        $this->assertSame(18, substr_count($html, 'class="button kcpw-aa-pick"'), 'a Pick button for each of 3 sets x 6 fields');
        $this->assertContains('data-target="kcpw-aa-g0-address"', $html);
        foreach (['name="f[pages][mode]"', 'name="f[pages][ids][]"', 'name="f[pages][paths]"', 'name="f[pages][account_address]"', 'name="f[countries]"', 'name="f[language]"', 'name="f[place_types]"'] as $name) {
            $this->assertContains($name, $html, $name);
        }
        $this->assertContains('nonce-for-kcpw_aa_form_save', $html);
        $this->assertContains('value="' . $form['id'] . '"', $html);
        $this->assertContains('<dialog id="kcpw-aa-picker"', $html);
        $this->assertContains('<iframe id="kcpw-aa-picker-frame"', $html);
        $this->assertContains('aria-labelledby="kcpw-aa-picker-title"', $html);
    }

    public function testEveryPickButtonPointsAtARealInput(): void
    {
        $form = FormConfig::sanitize($this->woo());
        $html = $this->screen([$form])->editorHtml($form, false);
        preg_match_all('/data-target="([^"]+)"/', $html, $targets);
        foreach ($targets[1] as $id) {
            $this->assertContains('id="' . $id . '"', $html, $id);
        }
    }

    public function testExtraFeatureSwitchesAppearOnlyForFeaturesSwitchedOnInSettings(): void
    {
        $form = FormConfig::sanitize($this->woo());
        $none = $this->screen([$form])->editorHtml($form, false);
        $this->assertNotContains('Extra features on this form', $none);
        $some = $this->screen([$form], ['modules' => ['gps' => true, 'pobox' => true]])->editorHtml($form, false);
        $this->assertContains('name="f[features][gps]"', $some);
        $this->assertContains('name="f[features][pobox]"', $some);
        $this->assertNotContains('name="f[features][map_picker]"', $some);
    }

    public function testChosenPagesComeFromThePublishedPages(): void
    {
        \WpStub::$pages = [(object) ['ID' => 7, 'post_title' => 'Contact <b>us</b>'], (object) ['ID' => 9, 'post_title' => 'Book']];
        $form = FormConfig::sanitize(['pages' => ['mode' => 'selected', 'ids' => [9]]] + $this->woo());
        $html = $this->screen([$form])->editorHtml($form, false);
        $this->assertContains('<option value="9" selected>Book</option>', $html);
        $this->assertContains('<option value="7">Contact &lt;b&gt;us&lt;/b&gt;</option>', $html, 'titles are escaped');
    }

    public function testTheScreenChoosesListEditorOrNewFromTheAddress(): void
    {
        $form = FormConfig::sanitize($this->woo());
        $this->assertContains('Address forms', $this->screen([$form])->screenHtml());
        $_GET['edit'] = $form['id'];
        $this->assertContains('Edit form', $this->screen([$form])->screenHtml());
        $_GET = ['edit' => 'f_unknown'];
        $this->assertContains('Address forms', $this->screen([$form])->screenHtml(), 'an unknown id falls back to the list');
        $_GET = ['new' => 'custom'];
        $this->assertContains('Add a form', $this->screen()->screenHtml());
        $_GET = ['new' => 'nonsense'];
        $this->assertContains('Address forms', $this->screen()->screenHtml());
    }

    public function testSavingANewFormFromPostedFields(): void
    {
        $s = $this->screen();
        $raw = [
            'name' => 'Contact page', 'enabled' => '1', 'mode' => 'smart',
            'groups' => [
                ['label' => 'Form', 'scope' => '', 'fields' => ['address' => '#addr', 'city' => '#city', 'state' => '', 'postcode' => '#zip', 'country' => '', 'address2' => '']],
                ['label' => 'Empty', 'scope' => '', 'fields' => ['address' => '', 'city' => '#c']],
            ],
            'pages' => ['mode' => 'selected', 'ids' => ['7'], 'paths' => "/contact/\n/x/*", 'account_address' => '0'],
            'countries' => 'us, ca', 'language' => '', 'place_types' => '',
        ];
        $this->assertSame('saved', $s->saveForm('', 'custom', $raw));
        $saved = \WpStub::$options['kcpw_aa_forms'];
        $this->assertSame(1, count($saved), 'the empty set was dropped');
        $this->assertSame('Contact page', $saved[0]['name']);
        $this->assertSame('#zip', $saved[0]['groups'][0]['fields']['postcode']);
        $this->assertSame([7], $saved[0]['pages']['ids']);
        $this->assertSame(['/contact/', '/x/*'], $saved[0]['pages']['paths']);
        $this->assertSame(['US', 'CA'], $saved[0]['countries']);
        $this->assertSame('custom', $saved[0]['preset']);
        $this->assertSame(false, \WpStub::$autoload['kcpw_aa_forms']);
    }

    public function testAFormWithoutAnAddressSelectorIsNotSaved(): void
    {
        $s = $this->screen();
        $this->assertSame('needs_selector', $s->saveForm('', 'custom', ['name' => 'x', 'groups' => [['fields' => ['city' => '#c']]]]));
        $this->assertSame([], \WpStub::$options);
    }

    public function testEditingKeepsTheIdAndPresetAndReplacesTheRest(): void
    {
        $form = FormConfig::sanitize($this->woo());
        $s = $this->screen([$form]);
        $raw = ['name' => 'Renamed', 'enabled' => '0', 'mode' => 'single', 'groups' => [['label' => 'S', 'fields' => ['address' => '#a']]], 'pages' => ['mode' => 'all']];
        $this->assertSame('saved', $s->saveForm($form['id'], 'ignored', $raw));
        $saved = \WpStub::$options['kcpw_aa_forms'];
        $this->assertSame(1, count($saved));
        $this->assertSame($form['id'], $saved[0]['id']);
        $this->assertSame('woo_block', $saved[0]['preset'], 'the preset a form began from is kept');
        $this->assertSame('Renamed', $saved[0]['name']);
        $this->assertFalse($saved[0]['enabled']);
        $this->assertSame('single', $saved[0]['mode']);
        $this->assertSame('error', $s->saveForm('f_nonexistent', 'custom', $raw), 'an id that does not exist is an error, not a new form');
    }

    public function testHostileSelectorsAndNamesAreCleaned(): void
    {
        $s = $this->screen();
        $s->saveForm('', 'custom', ['name' => '<script>alert(1)</script>Form', 'groups' => [['label' => '<b>x</b>', 'fields' => ['address' => '#a<img src=x>', 'city' => str_repeat('x', 400)]]]]);
        $saved = \WpStub::$options['kcpw_aa_forms'][0];
        $this->assertNotContains('<', json_encode($saved), 'no angle bracket survives');
        $this->assertSame('', $saved['groups'][0]['fields']['city'], 'an over-long selector is dropped');
    }

    public function testTheSaveHandlerNeedsTheCapabilityAndItsNonce(): void
    {
        $s = $this->screen();
        $_POST = ['id' => '', 'preset' => 'custom', 'f' => ['name' => 'x', 'groups' => [['fields' => ['address' => '#a']]]]];
        \WpStub::$canManage = false;
        $this->assertThrows(fn () => $s->onFormSave());
        \WpStub::$canManage = true;
        \WpStub::$nonceValid = false;
        $this->assertThrows(fn () => $s->onFormSave(), 'nonce');
        $this->assertSame([], \WpStub::$options);
        \WpStub::$nonceValid = true;
        $s->onFormSave();
        $this->assertSame(['kcpw_aa_form_save', 'kcpw_aa_form_save'], \WpStub::$nonceChecks);
        $this->assertContains('kcpw_msg=saved', (string) $s->redirected);
    }

    public function testAFailedSaveReturnsToTheEditorWithTheReason(): void
    {
        $s = $this->screen();
        $_POST = ['id' => '', 'preset' => 'custom', 'f' => ['name' => 'x', 'groups' => [['fields' => ['city' => '#c']]]]];
        $s->onFormSave();
        $this->assertContains('page=kcpw-aa-forms&new=custom&kcpw_msg=needs_selector', (string) $s->redirected);
    }

    public function testListActionsWorkByIdAndAreSafe(): void
    {
        $a = FormConfig::sanitize(['id' => 'f_aaaaaaaa'] + $this->woo());
        $b = FormConfig::sanitize(['id' => 'f_bbbbbbbb'] + FormConfig::blank('wpforms'));
        $s = $this->screen([$a, $b]);
        $this->assertTrue($s->formsAction('toggle', 'f_aaaaaaaa', ''));
        $this->assertFalse(\WpStub::$options['kcpw_aa_forms'][0]['enabled']);
        $this->assertTrue(\WpStub::$options['kcpw_aa_forms'][1]['enabled'], 'only the named form changed');
        $this->assertTrue($s->formsAction('duplicate', 'f_bbbbbbbb', ''));
        $forms = \WpStub::$options['kcpw_aa_forms'];
        $this->assertSame(3, count($forms));
        $this->assertContains('(copy)', $forms[2]['name']);
        $this->assertFalse($forms[2]['enabled'], 'a copy starts switched off');
        $this->assertTrue($forms[2]['id'] !== 'f_bbbbbbbb');
        $this->assertTrue($s->formsAction('delete', 'f_aaaaaaaa', ''));
        $this->assertSame(2, count(\WpStub::$options['kcpw_aa_forms']));
        $this->assertFalse($s->formsAction('toggle', 'f_zzzzzzzz', ''));
        $this->assertFalse($s->formsAction('format_disk', 'f_bbbbbbbb', ''));
        $this->assertTrue($s->formsAction('add_preset', '', 'cf7'));
        $this->assertFalse($s->formsAction('add_preset', '', 'custom'), 'a blank custom form is made in the editor');
        $this->assertFalse($s->formsAction('add_preset', '', 'nope'));
    }

    public function testTheListHandlerNeedsItsNonceAndTheCapability(): void
    {
        $s = $this->screen();
        $_POST = ['do' => 'add_preset', 'preset' => 'woo_block'];
        $s->onForms();
        $this->assertSame(['kcpw_aa_forms'], \WpStub::$nonceChecks);
        $this->assertContains('kcpw_msg=saved', (string) $s->redirected);
        \WpStub::$canManage = false;
        $this->assertThrows(fn () => $s->onForms());
    }

    public function testExportNeedsItsNonceAndNeverHoldsAKey(): void
    {
        $key = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';
        $s = $this->screen([$this->woo()], ['browser_key' => $key, 'server_key' => $key . 'X']);
        $s->onExport();
        $this->assertSame(['kcpw_aa_export'], \WpStub::$nonceChecks);
        $this->assertSame('kcpw-address-forms.json', $s->filename);
        $data = json_decode((string) $s->sent, true);
        $this->assertSame(1, $data['kcpw_address_autocomplete']);
        $this->assertSame(1, count($data['forms']));
        $this->assertNotContains('AbCdEf', (string) $s->sent);
        \WpStub::$nonceValid = false;
        $this->assertThrows(fn () => $s->onExport(), 'nonce');
        \WpStub::$canManage = false;
        \WpStub::$nonceValid = true;
        $this->assertThrows(fn () => $s->onExport());
    }

    public function testImportAddsFormsSwitchedOffWithFreshIds(): void
    {
        $source = FormConfig::sanitizeList([FormConfig::blank('woo_block'), FormConfig::blank('wpforms')]);
        $json = FormConfig::export($source);
        $existing = FormConfig::sanitize(['id' => 'f_existing1'] + FormConfig::blank('cf7'));
        $s = $this->screen([$existing]);
        $_POST = ['json' => addslashes($json)]; // WordPress slashes $_POST; the handler unslashes it
        $s->onImport();
        $this->assertSame(['kcpw_aa_import'], \WpStub::$nonceChecks);
        $forms = \WpStub::$options['kcpw_aa_forms'];
        $this->assertSame(3, count($forms));
        $this->assertSame('f_existing1', $forms[0]['id'], 'the existing form is untouched');
        $this->assertFalse($forms[1]['enabled']);
        $this->assertFalse($forms[2]['enabled'], 'imported forms arrive switched off');
        $this->assertTrue($forms[1]['id'] !== $source[0]['id']);
        $this->assertContains('kcpw_msg=imported&kcpw_n=2', (string) $s->redirected);
    }

    public function testImportRefusesAnythingThatIsNotOurFileAndRespectsTheLimit(): void
    {
        $s = $this->screen();
        foreach (['', 'not json', '{"forms":[]}', '[1,2,3]'] as $bad) {
            $_POST = ['json' => $bad];
            $s->onImport();
            $this->assertContains('kcpw_msg=bad_import', (string) $s->redirected, $bad);
        }
        $this->assertSame([], \WpStub::$options);
        $many = FormConfig::export(array_fill(0, FormConfig::MAX_FORMS, FormConfig::blank('woo_block')));
        $full = $this->screen(array_fill(0, FormConfig::MAX_FORMS - 1, FormConfig::blank('cf7')));
        $_POST = ['json' => addslashes($many)];
        $full->onImport();
        $this->assertSame(FormConfig::MAX_FORMS, count(\WpStub::$options['kcpw_aa_forms']), 'only what fits is taken');
        $this->assertContains('kcpw_n=1', (string) $full->redirected);
    }
}
