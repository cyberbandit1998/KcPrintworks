<?php
declare(strict_types=1);

namespace KcPrintworks\Core\Tests;

use KcPrintworks\Core\Options\OptionSchema;
use KcPrintworks\Core\Wp\PersonalizationPanel;

final class PersonalizationPanelTest extends TestCase
{
    private const NONCE = 'nonce-kcpw_save_personalization';

    private function post(array $extra = []): void
    {
        $_POST = $extra + [
            PersonalizationPanel::NONCE_FIELD => self::NONCE,
            'kcpw_fields' => [
                ['id' => '', 'label' => 'Name', 'type' => 'text', 'required' => '1', 'min' => '1', 'max' => '12'],
                ['id' => '', 'label' => 'Color', 'type' => 'select', 'choices' => "Red\nBlue | +1.00"],
            ],
        ];
    }

    private function stored(int $id): ?OptionSchema
    {
        $json = \WpStub::$postMeta[$id]['_kcpw_option_schema'] ?? null;
        return $json === null ? null : OptionSchema::fromJson($json);
    }

    public function testAddsAPersonalizationTab(): void
    {
        \WpStub::reset();
        $panel = new PersonalizationPanel();
        $panel->register();
        $this->assertTrue(isset(\WpStub::$filters['woocommerce_product_data_tabs']));
        $tabs = $panel->tab(['general' => ['label' => 'General']]);
        $this->assertSame('kcpw_personalization_data', $tabs['kcpw_personalization']['target']);
        $this->assertTrue(isset($tabs['general']), 'existing tabs are kept');
    }

    public function testSavesTheFormAsTheProductsSchema(): void
    {
        \WpStub::reset();
        $this->post();
        (new PersonalizationPanel())->save(42);
        $schema = $this->stored(42);
        $this->assertTrue($schema !== null);
        $this->assertSame(['name', 'color'], array_map(static fn ($f): string => $f->id, $schema->fields));
        $this->assertSame(100, $schema->fields[1]->choices[1]->priceEffect->value);
    }

    public function testDoesNothingWithoutAValidNonceOrPermission(): void
    {
        \WpStub::reset();
        $this->post([PersonalizationPanel::NONCE_FIELD => 'forged']);
        (new PersonalizationPanel())->save(42);
        $this->assertSame(null, $this->stored(42), 'bad nonce');

        $this->post();
        \WpStub::$caps = [];
        (new PersonalizationPanel())->save(42);
        $this->assertSame(null, $this->stored(42), 'no permission');

        \WpStub::$caps = ['edit_post'];
        $_POST = ['kcpw_fields' => [['label' => 'Name', 'type' => 'text', 'max' => '5']]];
        (new PersonalizationPanel())->save(42);
        $this->assertSame(null, $this->stored(42), 'no nonce at all');
    }

    public function testAMistakeKeepsWhatWasSavedBeforeAndExplainsItOnTheNextView(): void
    {
        \WpStub::reset();
        $this->post();
        (new PersonalizationPanel())->save(42);
        $before = \WpStub::$postMeta[42]['_kcpw_option_schema'];

        $this->post(['kcpw_fields' => [['id' => '', 'label' => 'Name', 'type' => 'text']]]); // no maximum length
        (new PersonalizationPanel())->save(42);
        $this->assertSame($before, \WpStub::$postMeta[42]['_kcpw_option_schema'], 'unchanged');

        $GLOBALS['post'] = (object) ['ID' => 42];
        ob_start();
        (new PersonalizationPanel())->panel();
        $html = (string) ob_get_clean();
        $this->assertStringContains('was not saved', $html);
        $this->assertStringContains('maximum length', $html);
        $this->assertStringContains('value="Name"', $html, 'the form still shows the saved setup');
        ob_start();
        (new PersonalizationPanel())->panel();
        $this->assertStringNotContains('was not saved', (string) ob_get_clean(), 'the message is shown once');
    }

    public function testClearingEveryRowRemovesPersonalization(): void
    {
        \WpStub::reset();
        $this->post();
        (new PersonalizationPanel())->save(42);
        $this->post(['kcpw_fields' => [['id' => 'name', 'label' => 'Name', 'type' => 'text', 'max' => '5', 'remove' => '1'], ['id' => 'color', 'label' => 'Color', 'type' => 'select', 'choices' => 'Red', 'remove' => '1']]]);
        (new PersonalizationPanel())->save(42);
        $this->assertSame(null, $this->stored(42));
    }

    public function testPastedJsonReplacesTheTableOnlyWhenItWasEdited(): void
    {
        \WpStub::reset();
        $this->post();
        (new PersonalizationPanel())->save(7);
        $json = \WpStub::$postMeta[7]['_kcpw_option_schema'];

        // Copying the JSON to another product: the pasted text differs from the (empty) original there.
        $this->post(['kcpw_schema_json' => $json, 'kcpw_schema_json_hash' => md5(''), 'kcpw_fields' => []]);
        (new PersonalizationPanel())->save(8);
        $this->assertSame($json, \WpStub::$postMeta[8]['_kcpw_option_schema']);

        // Untouched JSON box: the table wins.
        $this->post(['kcpw_schema_json' => $json, 'kcpw_schema_json_hash' => md5($json), 'kcpw_fields' => [['label' => 'Only', 'type' => 'text', 'max' => '3']]]);
        (new PersonalizationPanel())->save(8);
        $this->assertSame(['only'], array_map(static fn ($f): string => $f->id, $this->stored(8)->fields));

        // Bad pasted JSON is refused and explained.
        $this->post(['kcpw_schema_json' => '{"version":1,"fields":[{"id":"BAD","type":"text","label":"x","maxLength":3}]}', 'kcpw_schema_json_hash' => md5('x')]);
        $before = \WpStub::$postMeta[8]['_kcpw_option_schema'];
        (new PersonalizationPanel())->save(8);
        $this->assertSame($before, \WpStub::$postMeta[8]['_kcpw_option_schema']);
        $this->assertTrue(\WpStub::$transients !== []);
    }

    public function testASavedSetupThatIsBrokenIsReportedInThePanel(): void
    {
        \WpStub::reset();
        \WpStub::$postMeta[9]['_kcpw_option_schema'] = 'not json';
        $GLOBALS['post'] = (object) ['ID' => 9];
        ob_start();
        (new PersonalizationPanel())->panel();
        $html = (string) ob_get_clean();
        $this->assertStringContains('cannot be sold until it is fixed', $html);
    }
}
