<?php
declare(strict_types=1);

namespace KcPrintworks\Core\Tests;

use KcPrintworks\Core\Options\OptionSchema;
use KcPrintworks\Core\Options\OptionValidator;
use KcPrintworks\Core\Options\SchemaForm;
use KcPrintworks\Core\Options\SchemaFormView;
use KcPrintworks\Core\Support\Json;

final class SchemaFormTest extends TestCase
{
    private function bagTagRows(): array
    {
        return [
            ['id' => '', 'label' => 'Tag color', 'type' => 'select', 'required' => '1', 'choices' => "Black\nNavy\nHot Pink | +0.50"],
            ['id' => '', 'label' => 'Cable color', 'type' => 'radio', 'choices' => "Black\nSilver | +1.00"],
            ['id' => '', 'label' => 'Name or short text', 'type' => 'text', 'required' => '1', 'min' => '2', 'max' => '12', 'help' => 'Printed exactly as typed.'],
            ['id' => '', 'label' => 'Gift wrap', 'type' => 'checkbox', 'price' => '+4'],
            ['id' => '', 'label' => 'Rush', 'type' => 'checkbox', 'price' => '+15%'],
            ['id' => '', 'label' => '', 'type' => 'text'],
        ];
    }

    public function testBuildsAWorkingSchemaFromTheFormRows(): void
    {
        $result = SchemaForm::parse($this->bagTagRows());
        $this->assertSame([], $result['errors']);
        $schema = $result['schema'];
        $this->assertTrue($schema instanceof OptionSchema);
        $this->assertSame(['tag_color', 'cable_color', 'name_or_short_text', 'gift_wrap', 'rush'], array_map(static fn ($f): string => $f->id, $schema->fields));
        $this->assertTrue($schema->hasRequired());

        $input = Json::decode('{"tag_color":"hot-pink","cable_color":"silver","name_or_short_text":"Robin","gift_wrap":true,"rush":true}');
        $check = OptionValidator::validate($schema, $input);
        $this->assertTrue($check->ok, json_encode($check->issues) ?: '');
        // base 1000: hot pink 50 + silver 100 + gift 400 + rush 15% of 1000 = 150
        $this->assertSame(50 + 100 + 400 + 150, OptionValidator::adders($schema, $check->values, 1000));
    }

    public function testIdsAndChoiceValuesStayPutWhenLabelsChange(): void
    {
        $first = SchemaForm::parse($this->bagTagRows())['schema'];
        $rows = $this->bagTagRows();
        $rows[0]['id'] = 'tag_color';
        $rows[0]['label'] = 'Color of the tag'; // renamed
        $second = SchemaForm::parse($rows)['schema'];
        $this->assertSame('tag_color', $second->fields[0]->id, 'the id is kept');
        $this->assertSame('Color of the tag', $second->fields[0]->label);
        $this->assertSame($first->fields[0]->choices[2]->value, $second->fields[0]->choices[2]->value);
    }

    public function testRemovedAndBlankRowsAreDropped(): void
    {
        $rows = $this->bagTagRows();
        $rows[1]['remove'] = '1';
        $schema = SchemaForm::parse($rows)['schema'];
        $this->assertSame(4, count($schema->fields));
        $this->assertTrue(SchemaForm::parse([['label' => '', 'type' => 'text']])['schema']->isEmpty());
        $this->assertTrue(SchemaForm::parse([])['schema']->isEmpty());
    }

    public function testExplainsEachMistakeInPlainWords(): void
    {
        $cases = [
            [['label' => 'Name', 'type' => 'text'], 'maximum length'],
            [['label' => 'Name', 'type' => 'text', 'max' => 'abc'], 'whole numbers'],
            [['label' => 'Color', 'type' => 'select', 'choices' => ''], 'at least one choice'],
            [['label' => 'Color', 'type' => 'select', 'choices' => " | +1"], 'needs a name'],
            [['label' => 'Gift', 'type' => 'checkbox', 'price' => 'lots'], 'not a price change'],
            [['label' => 'Gift', 'type' => 'checkbox', 'price' => '+200000'], 'not a valid amount'],
            [['label' => 'Thing', 'type' => 'upload'], 'type must be'],
        ];
        foreach ($cases as [$row, $needle]) {
            $result = SchemaForm::parse([$row]);
            $this->assertNull($result['schema'], $needle);
            $this->assertTrue($result['errors'] !== [], $needle);
            $this->assertStringContains($needle, implode(' ', $result['errors']));
        }
    }

    public function testDuplicateLabelsGetDistinctIdsAndChoiceValues(): void
    {
        $schema = SchemaForm::parse([
            ['label' => 'Color', 'type' => 'select', 'choices' => "Red\nRed\nBlue"],
            ['label' => 'Color', 'type' => 'text', 'max' => '5'],
        ])['schema'];
        $this->assertSame(['color', 'color_2'], array_map(static fn ($f): string => $f->id, $schema->fields));
        $this->assertSame(['red', 'red-2', 'blue'], array_map(static fn ($c): string => $c->value, $schema->fields[0]->choices));
    }

    public function testPriceNotation(): void
    {
        $this->assertSame(['kind' => 'flat', 'amount' => 250], SchemaForm::effect('+2.50'));
        $this->assertSame(['kind' => 'flat', 'amount' => 250], SchemaForm::effect('2.5'));
        $this->assertSame(['kind' => 'flat', 'amount' => -100], SchemaForm::effect('-1'));
        $this->assertSame(['kind' => 'percent', 'basisPoints' => 1000], SchemaForm::effect('+10%'));
        $this->assertSame(['kind' => 'percent', 'basisPoints' => 1250], SchemaForm::effect('12.5%'));
        $this->assertSame(['kind' => 'percent', 'basisPoints' => -500], SchemaForm::effect('-5%'));
        $this->assertNull(SchemaForm::effect(''));
        $this->assertNull(SchemaForm::effect('0'));
    }

    public function testTheFormShowsWhatWasSavedAndEscapesIt(): void
    {
        $schema = SchemaForm::parse($this->bagTagRows())['schema'];
        $html = SchemaFormView::render($schema);
        $this->assertStringContains('value="Tag color"', $html);
        $this->assertStringContains('Hot Pink | +0.50', $html);
        $this->assertStringContains('value="+15%"', $html);
        $this->assertStringContains('value="+4.00"', $html);
        $this->assertStringContains('name="kcpw_fields[6][label]"', $html, 'two spare rows after the five fields');
        $this->assertStringNotContains('name="kcpw_fields[7][label]"', $html);
        // Saving what was shown gives the same schema back.
        $roundTrip = SchemaForm::parse($this->rowsFromSchema($schema))['schema'];
        $this->assertSame($schema->toArray(), $roundTrip->toArray());

        $evil = OptionSchema::fromDecoded(['version' => 1, 'fields' => [['id' => 'x', 'type' => 'text', 'label' => '"><script>alert(1)</script>', 'maxLength' => 5]]]);
        $out = SchemaFormView::render($evil, ['<b>bad</b>']);
        $this->assertStringNotContains('<script>', $out);
        $this->assertStringNotContains('<b>bad</b>', $out);
    }

    /** @return list<array<string,string>> what a browser would post back for the rendered form */
    private function rowsFromSchema(OptionSchema $schema): array
    {
        $rows = [];
        foreach ($schema->fields as $f) {
            $choices = [];
            foreach ($f->choices as $c) {
                $p = SchemaForm::formatEffect($c->priceEffect);
                $choices[] = $c->label . ($p !== '' ? " | $p" : '');
            }
            $rows[] = [
                'id' => $f->id, 'label' => $f->label, 'type' => $f->type, 'required' => $f->required ? '1' : '',
                'min' => $f->isText() ? (string) $f->minLength : '', 'max' => $f->isText() ? (string) $f->maxLength : '',
                'choices' => implode("\n", $choices), 'price' => $f->isChoice() ? '' : SchemaForm::formatEffect($f->priceEffect), 'help' => $f->helpText ?? '',
            ];
        }
        return $rows;
    }
}
