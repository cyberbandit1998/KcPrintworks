<?php
declare(strict_types=1);

namespace KcPrintworks\Core\Tests;

use KcPrintworks\Core\Cart\LineIntent;
use KcPrintworks\Core\Cart\LineResolver;
use KcPrintworks\Core\Catalog\ProductModel;
use KcPrintworks\Core\Support\Json;

/** The shared line vectors (packages/contracts/test/vectors/lines.json), generated from the storefront's reference. */
final class LineVectorsTest extends TestCase
{
    public function testEveryLineResolvesLikeTheTypeScriptReference(): void
    {
        $file = dirname(__DIR__, 3) . '/packages/contracts/test/vectors/lines.json';
        if (!is_file($file)) {
            $this->skip('shared vectors not found');
        }
        $vectors = Json::decode((string) file_get_contents($file));
        $products = [];
        foreach (get_object_vars($vectors->products) as $name => $dto) {
            $products[$name] = ProductModel::fromDto(Json::assoc($dto));
        }
        $resolver = new LineResolver();
        $this->assertTrue(count($vectors->cases) >= 25, 'expected at least 25 cases');

        foreach ($vectors->cases as $case) {
            $label = $case->name;
            $line = $resolver->resolve($products[$case->product] ?? null, LineIntent::parse($case->intent, 0));
            $e = $case->expected;

            $this->assertSame(
                array_map(static fn ($i): array => ['code' => $i->code] + (isset($i->field) ? ['field' => $i->field] : []), $e->issues),
                array_map(static fn (array $i): array => ['code' => $i['code']] + (isset($i['field']) ? ['field' => $i['field']] : []), $line->issues),
                "$label: issue codes",
            );
            $this->assertSame($e->variationId, $line->variation?->id, "$label: variation");
            $this->assertSame($e->variationLabel, $line->variationLabel, "$label: variation label");
            $this->assertSame($e->unitPrice, $line->unitCents, "$label: unit price");
            $this->assertSame($e->optionAdders, $line->addersCents, "$label: option adders");
            $this->assertSame($e->lineTotal, $line->lineTotalCents(), "$label: line total");
            $this->assertSame(
                Json::assoc($e->summary),
                array_map(static fn (array $s): array => [$s['fieldId'], $s['value']], $line->summary),
                "$label: option summary",
            );
        }
    }
}
