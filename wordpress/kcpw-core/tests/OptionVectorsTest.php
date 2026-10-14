<?php
declare(strict_types=1);

namespace KcPrintworks\Core\Tests;

use KcPrintworks\Core\Options\OptionSchema;
use KcPrintworks\Core\Options\OptionValidator;
use KcPrintworks\Core\Support\Json;

/**
 * The 33 shared personalization vectors (packages/contracts/test/vectors/options.json), generated from the TypeScript
 * reference. Passing them is the definition of "the server validates exactly as the storefront does".
 */
final class OptionVectorsTest extends TestCase
{
    private function vectors(): \stdClass
    {
        $file = dirname(__DIR__, 3) . '/packages/contracts/test/vectors/options.json';
        if (!is_file($file)) {
            $this->skip('shared vectors not found');
        }
        return Json::decode((string) file_get_contents($file));
    }

    public function testEveryVectorGivesTheSameResultAsTheTypeScriptReference(): void
    {
        $vectors = $this->vectors();
        $schemas = [];
        foreach (get_object_vars($vectors->schemas) as $name => $schema) {
            $schemas[$name] = OptionSchema::fromDecoded($schema);
        }
        $this->assertTrue(count($vectors->cases) >= 33, 'expected at least 33 cases');
        foreach ($vectors->cases as $case) {
            $schema = $schemas[$case->schema];
            $result = OptionValidator::validate($schema, $case->input);
            $expected = $case->expected;
            $label = $case->name;

            $this->assertSame($expected->ok, $result->ok, "$label: ok");
            $this->assertSame(
                array_map(static fn ($i): array => ['fieldId' => $i->fieldId, 'code' => $i->code], $expected->issues),
                array_map(static fn (array $i): array => ['fieldId' => $i['fieldId'], 'code' => $i['code']], $result->issues),
                "$label: issues",
            );
            if ($expected->ok) {
                $this->assertSame(Json::assoc($expected->values), $result->values, "$label: values");
                $adders = OptionValidator::adders($schema, $result->values, $case->base->amount);
                $this->assertSame($expected->adders, $adders, "$label: price adders");
                $summary = array_map(
                    static fn (array $s): array => [$s['fieldId'], $s['value']],
                    OptionValidator::summary($schema, $result->values),
                );
                $this->assertSame(Json::assoc($expected->summary), $summary, "$label: summary");
            }
        }
    }

    public function testSchemaRoundTripsThroughJson(): void
    {
        $vectors = $this->vectors();
        $schema = OptionSchema::fromDecoded($vectors->schemas->bag_tag);
        $again = OptionSchema::fromJson($schema->toJson());
        $this->assertSame($schema->toArray(), $again->toArray());
    }

    public function testSchemaRejectsWhatTheContractRejects(): void
    {
        $bad = [
            '{"version":1,"fields":[{"id":"Name","type":"text","label":"Name","maxLength":10}]}' => 'id',
            '{"version":1,"fields":[{"id":"name","type":"text","label":"","maxLength":10}]}' => 'label',
            '{"version":1,"fields":[{"id":"name","type":"text","label":"Name"}]}' => 'maxLength',
            '{"version":1,"fields":[{"id":"name","type":"text","label":"Name","maxLength":501}]}' => 'maxLength',
            '{"version":1,"fields":[{"id":"c","type":"select","label":"C","choices":[]}]}' => 'choices',
            '{"version":1,"fields":[{"id":"c","type":"select","label":"C","choices":[{"value":"A B","label":"x"}]}]}' => 'choice',
            '{"version":1,"fields":[{"id":"c","type":"select","label":"C","choices":[{"value":"a","label":"x"},{"value":"a","label":"y"}]}]}' => 'twice',
            '{"version":1,"fields":[{"id":"a","type":"checkbox","label":"A"},{"id":"a","type":"checkbox","label":"B"}]}' => 'unique',
            '{"version":1,"fields":[{"id":"a","type":"upload","label":"A"}]}' => 'type must be',
            '{"version":1,"fields":[{"id":"a","type":"checkbox","label":"A","priceEffect":{"kind":"flat","amount":1.5}}]}' => 'priceEffect',
            '{"version":0,"fields":[]}' => 'version',
            '[1,2]' => 'object',
        ];
        foreach ($bad as $json => $needle) {
            $this->assertThrows(\KcPrintworks\Core\Options\SchemaError::class, static fn () => OptionSchema::fromJson($json), $needle);
        }
        $this->assertThrows(\KcPrintworks\Core\Options\SchemaError::class, static fn () => OptionSchema::fromJson('{nope'), 'JSON');
        $tooMany = json_encode(['version' => 1, 'fields' => array_map(static fn (int $i): array => ['id' => 'f' . $i, 'type' => 'checkbox', 'label' => 'F'], range(1, 21))]);
        $this->assertThrows(\KcPrintworks\Core\Options\SchemaError::class, static fn () => OptionSchema::fromJson((string) $tooMany), 'At most 20');
    }
}
