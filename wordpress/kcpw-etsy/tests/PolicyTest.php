<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Tests;

use KcPrintworks\Etsy\Model\Listing;
use KcPrintworks\Etsy\Sync\ConflictDetector;
use KcPrintworks\Etsy\Sync\FieldPolicy;
use KcPrintworks\Etsy\Sync\InventoryPolicy;
use KcPrintworks\Etsy\Sync\Override;
use KcPrintworks\Etsy\Sync\PlanItem;
use KcPrintworks\Etsy\Sync\PricePolicy;

final class PolicyTest extends TestCase
{
    public function testEtsyOwnsTheCatalogAndTheWebsiteOwnsUrlsCategoriesShippingAndSeo(): void
    {
        foreach (['title', 'description', 'images', 'variations', 'base_price'] as $field) {
            $this->assertSame('etsy', FieldPolicy::ownerOf($field), $field);
            $this->assertTrue(FieldPolicy::syncMayWrite($field));
        }
        foreach (['slug', 'categories', 'seo', 'shipping', 'tax', 'visibility', 'website_price'] as $field) {
            $this->assertSame('website', FieldPolicy::ownerOf($field), $field);
            $this->assertFalse(FieldPolicy::syncMayWrite($field), $field);
        }
        $this->assertThrows(\InvalidArgumentException::class, fn () => FieldPolicy::ownerOf('nonsense'));
    }

    public function testOnlyEtsyOwnedFieldsCanBeOverridden(): void
    {
        $override = new Override(10, 'title', 'SEO wording', 'owner', '2026-10-14');
        $this->assertSame('title', $override->field);
        $this->assertThrows(\InvalidArgumentException::class, fn () => new Override(10, 'slug', 'x', 'owner', 'now'), 'Etsy-owned');
    }

    public function testPricePolicyIsIntegerMathRoundedAwayFromZero(): void
    {
        $this->assertSame(1524, (new PricePolicy())->websitePriceCents(1524));
        $this->assertSame(1676, (new PricePolicy(PricePolicy::MARKUP_PERCENT, 1000))->websitePriceCents(1524), '10% of 1524 = 152.4 -> 152');
        $this->assertSame(890 + 134, (new PricePolicy(PricePolicy::MARKUP_PERCENT, 1500))->websitePriceCents(890), '15% of 890 = 133.5 rounds half up to 134');
        $this->assertSame(899 + 135, (new PricePolicy(PricePolicy::MARKUP_PERCENT, 1500))->websitePriceCents(899), '15% of 899 = 134.85 rounds to 135');
        $this->assertSame(1000 - 105, (new PricePolicy(PricePolicy::MARKUP_PERCENT, -1050))->websitePriceCents(1000), '-10.5% of 1000 = -105');
    }

    public function testPricePolicyVariants(): void
    {
        $this->assertSame(1100, (new PricePolicy(PricePolicy::FIXED_DELTA, 200))->websitePriceCents(900));
        $this->assertSame(700, (new PricePolicy(PricePolicy::FIXED_DELTA, -200))->websitePriceCents(900));
        $this->assertSame(0, (new PricePolicy(PricePolicy::FIXED_DELTA, -5000))->websitePriceCents(900), 'never negative');
        $this->assertSame(1999, (new PricePolicy(PricePolicy::FIXED, 1999))->websitePriceCents(900), 'a fixed website price ignores Etsy');
        $this->assertSame('Etsy +10.00%', (new PricePolicy(PricePolicy::MARKUP_PERCENT, 1000))->describe());
        $this->assertThrows(\InvalidArgumentException::class, fn () => new PricePolicy('discount'));
    }

    private function listing(string $whenMade = 'made_to_order'): Listing
    {
        return Fixtures::listing(1, ['when_made' => $whenMade], [[10, 'A', ['C' => 'x'], 100], [11, 'B', ['C' => 'y'], 100, false]]);
    }

    public function testMadeToOrderNeverMarksAPrintableItemOutOfStockFromEtsyQuantity(): void
    {
        $listing = $this->listing();
        $zeroQuantity = new \KcPrintworks\Etsy\Model\Variant(10, 'A', [], null, 0, true, false);
        $decision = InventoryPolicy::forVariant(InventoryPolicy::MADE_TO_ORDER, $listing, $zeroQuantity);
        $this->assertSame('instock', $decision['status']);
        $this->assertFalse($decision['manage_stock']);
        $this->assertNull($decision['quantity']);
    }

    public function testASwitchedOffEtsyOfferingStillMakesAVariationUnavailable(): void
    {
        $listing = $this->listing();
        $decision = InventoryPolicy::forVariant(InventoryPolicy::MADE_TO_ORDER, $listing, $listing->variants[1]);
        $this->assertSame('outofstock', $decision['status']);
    }

    public function testEtsyQuantityPolicyMirrorsQuantityAndWooManagedLeavesStockAlone(): void
    {
        $listing = $this->listing('2020_2026');
        $variant = new \KcPrintworks\Etsy\Model\Variant(10, 'A', [], null, 7, true, false);
        $this->assertSame(['manage_stock' => true, 'status' => 'instock', 'quantity' => 7, 'reason' => 'Etsy quantity mirrored'], InventoryPolicy::forVariant(InventoryPolicy::ETSY_QUANTITY, $listing, $variant));
        $sold = new \KcPrintworks\Etsy\Model\Variant(10, 'A', [], null, 0, true, false);
        $this->assertSame('outofstock', InventoryPolicy::forVariant(InventoryPolicy::ETSY_QUANTITY, $listing, $sold)['status']);
        $this->assertNull(InventoryPolicy::forVariant(InventoryPolicy::WOO_MANAGED, $listing, $variant));
        $this->assertThrows(\InvalidArgumentException::class, fn () => InventoryPolicy::assertValid('shared_pool'));
    }

    public function testDefaultPolicyFollowsEtsyWhenMadeAndTheShopDefaultOtherwise(): void
    {
        $this->assertSame('made_to_order', InventoryPolicy::defaultFor($this->listing('made_to_order'), InventoryPolicy::WOO_MANAGED));
        $this->assertSame('woo_managed', InventoryPolicy::defaultFor($this->listing('2020_2026'), InventoryPolicy::WOO_MANAGED));
    }

    public function testThreeWayConflictDetection(): void
    {
        $h = fn (string $v): string => ConflictDetector::hash($v);
        $this->assertSame(PlanItem::IN_SYNC, ConflictDetector::classify(null, $h('a'), $h('a'))['status']);
        $this->assertSame(PlanItem::CHANGE, ConflictDetector::classify(null, $h('a'), $h('b'))['status'], 'first sync');
        $this->assertSame(PlanItem::IN_SYNC, ConflictDetector::classify($h('a'), $h('a'), $h('a'))['status']);
        $this->assertSame(PlanItem::CHANGE, ConflictDetector::classify($h('old'), $h('new'), $h('old'))['status'], 'only Etsy changed');
        $this->assertSame(PlanItem::WEBSITE_EDIT, ConflictDetector::classify($h('old'), $h('old'), $h('site'))['status'], 'only the website changed');
        $this->assertSame(PlanItem::CONFLICT, ConflictDetector::classify($h('old'), $h('new'), $h('site'))['status'], 'both changed');
        $this->assertSame(PlanItem::IN_SYNC, ConflictDetector::classify($h('old'), $h('same'), $h('same'))['status'], 'both changed to the same value');
    }
}
