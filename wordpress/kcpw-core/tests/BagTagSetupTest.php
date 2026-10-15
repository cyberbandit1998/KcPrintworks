<?php
declare(strict_types=1);

namespace KcPrintworks\Core\Tests;

use KcPrintworks\Core\Options\OptionSchema;
use KcPrintworks\Core\Options\OptionValidator;
use KcPrintworks\Core\Wp\CartHooks;
use KcPrintworks\Core\Wp\WcProductSource;

/**
 * The personalized bag tag's setup, exactly as docs/BAG-TAG-PERSONALIZATION.md tells the owner to paste it into the product's
 * Personalization tab: it must be valid for this plugin, accept what a shopper types, and end up on the WooCommerce order item as
 * readable lines for the seller. A product with NO stored setup must refuse the same choices (that is what the document explains).
 */
final class BagTagSetupTest extends TestCase
{
    private function pastedJson(): string
    {
        $doc = (string) file_get_contents(dirname(__DIR__, 3) . '/docs/BAG-TAG-PERSONALIZATION.md');
        if (preg_match('/```json\n(.+?)\n```/s', $doc, $m) !== 1) {
            throw new \RuntimeException('docs/BAG-TAG-PERSONALIZATION.md has no json block');
        }
        return trim($m[1]);
    }

    public function testTheDocumentedSetupIsValidAndCanonicalForThisPlugin(): void
    {
        $json = $this->pastedJson();
        $schema = OptionSchema::fromJson($json);
        $this->assertSame($json, $schema->toJson(), 'the pasted text is exactly what the plugin itself would store');
        $this->assertSame(['name', 'icon', 'cable_color'], array_map(static fn ($f): string => $f->id, $schema->fields));
        $this->assertTrue($schema->hasRequired());
    }

    public function testItAcceptsTheNameIconAndCableColorAShopperTypes(): void
    {
        $schema = OptionSchema::fromJson($this->pastedJson());
        foreach (['Dog', 'Cat', 'Flower'] as $icon) {
            $result = OptionValidator::validate($schema, (object) ['name' => 'Robin', 'icon' => $icon, 'cable_color' => 'Black']);
            $this->assertTrue($result->ok, $icon);
        }
        $this->assertTrue(OptionValidator::validate($schema, (object) ['name' => 'Robin'])->ok, 'icon and cable color are optional');
        $this->assertFalse(OptionValidator::validate($schema, (object) ['icon' => 'Dog'])->ok, 'the name is required');
    }

    public function testEveryChoiceIsSavedOnTheOrderItemAsReadableLinesForTheSeller(): void
    {
        \WpStub::reset();
        $schema = OptionSchema::fromJson($this->pastedJson());
        $validation = OptionValidator::validate($schema, (object) ['name' => 'Robin', 'icon' => 'Flower', 'cable_color' => 'Black']);
        $this->assertTrue($validation->ok);
        $summary = OptionValidator::summary($schema, $validation->values);

        $product = GlueFixtures::product(889, 'Personalized Bag Tag', '12.00', [WcProductSource::META_SCHEMA => $this->pastedJson()]);
        $cartItem = [
            'product_id' => $product->get_id(),
            'variation_id' => 0,
            'data' => $product,
            'kcpw' => ['options' => $validation->values, 'summary' => $summary, 'schemaVersion' => 1],
        ];

        // The shopper sees them in the WooCommerce cart and checkout summary...
        $rows = (new CartHooks())->itemData([], $cartItem);
        $this->assertSame(
            [['Name or short text', 'Robin'], ['Icon', 'Flower'], ['Cable color', 'Black']],
            array_map(static fn (array $r): array => [$r['key'], $r['value']], $rows),
        );

        // ...and the seller sees them on the order item (admin, emails, packing slips), with one hidden record for automation.
        $item = new \WC_Order_Item_Product();
        (new CartHooks())->saveOnOrderItem($item, 'k', $cartItem, new \WC_Order());
        $this->assertSame(['Name or short text', 'Robin'], array_slice($item->meta[0], 0, 2));
        $this->assertSame(['Icon', 'Flower'], array_slice($item->meta[1], 0, 2));
        $this->assertSame(['Cable color', 'Black'], array_slice($item->meta[2], 0, 2));
        $this->assertSame('_kcpw_personalization', $item->meta[3][0]);
        $record = json_decode($item->meta[3][1], true);
        $this->assertSame(['name' => 'Robin', 'icon' => 'Flower', 'cable_color' => 'Black'], $record['values']);
    }

    public function testAnEmptyOptionalFieldIsNotListed(): void
    {
        $schema = OptionSchema::fromJson($this->pastedJson());
        $validation = OptionValidator::validate($schema, (object) ['name' => 'Robin', 'icon' => '', 'cable_color' => '']);
        $this->assertTrue($validation->ok);
        $labels = array_map(static fn (array $row): string => (string) $row['label'], OptionValidator::summary($schema, $validation->values));
        $this->assertSame(['Name or short text'], $labels);
    }

    public function testAProductWithNoStoredSetupRefusesTheSameChoices(): void
    {
        $result = OptionValidator::validate(OptionSchema::empty(), (object) ['name' => 'Robin', 'icon' => 'Flower']);
        $this->assertFalse($result->ok);
        $codes = array_unique(array_map(static fn (array $issue): string => (string) $issue['code'], $result->issues));
        $this->assertSame(['unknown_field'], array_values($codes));
    }
}
