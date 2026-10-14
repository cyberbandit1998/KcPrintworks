<?php
declare(strict_types=1);

namespace KcPrintworks\Core\Tests;

use KcPrintworks\Core\Cart\LineIntent;
use KcPrintworks\Core\Cart\LineResolver;
use KcPrintworks\Core\Support\Json;
use KcPrintworks\Core\Wp\WcProductSource;

/** The mapping from WooCommerce product objects to the model, including the odd shapes the real catalog has. */
final class WcProductSourceTest extends TestCase
{
    private function bagTag(): \WC_Product
    {
        $tag = new \WC_Product(889, 'Bag Tag');
        $tag->type = 'variable';
        $tag->price = '12.00';
        $tag->variationMin = '12.00';
        $tag->attributes = [
            'tag-color' => new \WC_Product_Attribute('Tag Color', false, true, ['Black', 'Navy', 'Hot Pink']),
            'pa_text_color' => new \WC_Product_Attribute('pa_text_color', true, true, [new \WP_Term('White', 'white'), new \WP_Term('Dark Red', 'dark-red')]),
            'condition' => new \WC_Product_Attribute('Condition', false, false, ['MADE_TO_ORDER']),
        ];
        // The real catalog: every variation is "Any" for both attributes.
        foreach ([8891, 8892] as $id) {
            $v = new \WC_Product_Variation($id, 'Bag Tag variation');
            $v->price = '12.00';
            $v->variationAttributes = ['attribute_tag-color' => '', 'attribute_pa_text_color' => ''];
            \WpStub::$products[$id] = $v;
            $tag->children[] = $id;
        }
        \WpStub::$products[889] = $tag;
        return $tag;
    }

    public function testMapsAnAnyVariationProductAndBuildsWooCommerceAddToCartFields(): void
    {
        \WpStub::reset();
        $tag = $this->bagTag();
        $tag->meta['_kcpw_option_schema'] = '{"version":1,"fields":[{"id":"name","type":"text","label":"Name","required":true,"minLength":1,"maxLength":12}]}';
        $model = (new WcProductSource())->find(889);
        $this->assertTrue($model !== null);
        $this->assertSame('variable', $model->type);
        $this->assertSame(1200, $model->priceCents);
        $this->assertSame('USD', $model->currency);
        $this->assertTrue($model->purchasable);
        $this->assertCount(2, $model->variations);
        $this->assertSame(['tag-color' => '', 'text-color' => ''], $model->variations[0]->attributes);
        $slugs = array_map(static fn ($a): string => $a->slug, $model->variationAttributes());
        $this->assertSame(['tag-color', 'text-color'], $slugs, 'slugs match the storefront (label, not the pa_ name)');

        $intent = LineIntent::parse(Json::decode('{"productId":889,"variationId":8891,"quantity":1,"attributes":{"tag-color":"navy","text-color":"dark-red"},"options":{"name":"Robin"}}'), 0);
        $line = (new LineResolver())->resolve($model, $intent);
        $this->assertSame([], $line->issues, json_encode($line->issues) ?: '');
        $this->assertSame(
            ['attribute_tag-color' => 'Navy', 'attribute_pa_text_color' => 'dark-red'],
            $line->wcVariationAttributes(),
            'custom attributes use the option text, taxonomy attributes the term slug: what WooCommerce add-to-cart expects',
        );
    }

    public function testTheOptionalMarkersAreReadButNeverRequired(): void
    {
        \WpStub::reset();
        $plain = GlueFixtures::product(1, 'Plain');
        $this->assertFalse((new WcProductSource())->find(1)->madeToOrder);
        $plain->meta['_kcpw_made_to_order'] = 'yes';
        $this->assertTrue((new WcProductSource())->find(1)->madeToOrder);
        $plain->meta = [];
        \WpStub::$terms[1]['product_tag'] = ['made-to-order'];
        $this->assertTrue((new WcProductSource())->find(1)->madeToOrder);
    }

    public function testStockRulesFollowWooCommerce(): void
    {
        \WpStub::reset();
        $p = GlueFixtures::product(2, 'Stocked', '5.00');
        $p->managing = true;
        $p->stockQuantity = 4;
        $this->assertSame(4, (new WcProductSource())->find(2)->stockQuantity);
        $p->backorders = true;
        $this->assertSame(null, (new WcProductSource())->find(2)->stockQuantity, 'backorders allowed: no limit');
        $p->backorders = false;
        $p->stockQuantity = -3;
        $this->assertSame(0, (new WcProductSource())->find(2)->stockQuantity);
        $p->stockStatus = 'outofstock';
        $this->assertSame('outofstock', (new WcProductSource())->find(2)->stockStatus);
    }

    public function testProductsThatCannotBeSoldAreNotOfferedOrNotFound(): void
    {
        \WpStub::reset();
        $this->assertNull((new WcProductSource())->find(404), 'no such product');
        $draft = GlueFixtures::product(3, 'Draft');
        $draft->status = 'draft';
        $this->assertNull((new WcProductSource())->find(3));
        $odd = GlueFixtures::product(4, 'Grouped');
        $odd->type = 'grouped';
        $this->assertNull((new WcProductSource())->find(4));
        $noPrice = GlueFixtures::product(5, 'No price', '');
        $noPrice->purchasable = false;
        $model = (new WcProductSource())->find(5);
        $this->assertFalse($model->purchasable);
    }

    public function testABrokenPersonalizationSetupMakesTheProductUnsellableInsteadOfSilentlyDroppingIt(): void
    {
        \WpStub::reset();
        GlueFixtures::product(6, 'Broken', '9.00', ['_kcpw_option_schema' => '{"version":1,"fields":[{"id":"Bad Id","type":"text","label":"x","maxLength":5}]}']);
        $model = (new WcProductSource())->find(6);
        $this->assertFalse($model->purchasable);
        $line = (new LineResolver())->resolve($model, LineIntent::parse(Json::decode('{"productId":6,"quantity":1}'), 0));
        $this->assertSame('unavailable', $line->issues[0]['code']);
    }

    public function testVariationsWithoutAPriceOrOffTheMenuAreLeftOut(): void
    {
        \WpStub::reset();
        $tag = $this->bagTag();
        \WpStub::$products[8891]->status = 'private';        // disabled in WooCommerce
        \WpStub::$products[8892]->purchasable = false;       // not purchasable
        $model = (new WcProductSource())->find(889);
        $this->assertCount(0, $model->variations);
        $this->assertTrue($tag instanceof \WC_Product);
    }

    public function testASpecificVariationValueIsMatchedBySlugOrByText(): void
    {
        \WpStub::reset();
        $this->bagTag();
        $v = \WpStub::$products[8891];
        $v->variationAttributes = ['attribute_tag-color' => 'Hot Pink', 'attribute_pa_text_color' => 'white'];
        $model = (new WcProductSource())->find(889);
        $this->assertSame(['tag-color' => 'hot-pink', 'text-color' => 'white'], $model->variations[0]->attributes);
        // A value that matches no option makes that variation unusable rather than guessed.
        $v->variationAttributes = ['attribute_tag-color' => 'Chartreuse', 'attribute_pa_text_color' => ''];
        $model = (new WcProductSource())->find(889);
        $this->assertCount(1, $model->variations);
        $this->assertSame(8892, $model->variations[0]->id);
    }
}
