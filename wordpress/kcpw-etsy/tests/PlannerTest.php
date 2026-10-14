<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Tests;

use KcPrintworks\Etsy\Match\ArrayDecisionStore;
use KcPrintworks\Etsy\Match\Decision;
use KcPrintworks\Etsy\Match\Matcher;
use KcPrintworks\Etsy\Sync\ConflictDetector;
use KcPrintworks\Etsy\Sync\FieldPolicy;
use KcPrintworks\Etsy\Sync\Override;
use KcPrintworks\Etsy\Sync\Plan;
use KcPrintworks\Etsy\Sync\PlanContext;
use KcPrintworks\Etsy\Sync\PlanEntry;
use KcPrintworks\Etsy\Sync\PlanItem;
use KcPrintworks\Etsy\Sync\Planner;
use KcPrintworks\Etsy\Sync\PricePolicy;
use KcPrintworks\Etsy\Woo\WooVariation;

final class PlannerTest extends TestCase
{
    /** Plans a single approved link between one listing and one product. */
    private function plan(\KcPrintworks\Etsy\Model\Listing $listing, \KcPrintworks\Etsy\Woo\WooProduct $woo, ?PlanContext $context = null, bool $approve = true): Plan
    {
        $decisions = $approve ? [$listing->id => new Decision($listing->id, Decision::LINK, $woo->id)] : [];
        $report = (new Matcher())->match([$listing], [$woo], [], $decisions);
        return (new Planner())->plan($report, $context ?? new PlanContext());
    }

    private function item(Plan $plan, string $field): PlanItem
    {
        foreach ($plan->entries[0]->items as $item) {
            if ($item->field === $field) {
                return $item;
            }
        }
        throw new \LogicException('No plan item for ' . $field);
    }

    public function testAnIdenticalProductHasNothingToChangeAndTheWebsiteFieldsAreUntouched(): void
    {
        $listing = Fixtures::listing(1, [], [[10, 'SKU-1', ['Color' => 'Red'], 1524]], [5551234567]);
        $woo = Fixtures::woo(10, 'Skip-Bo Card Game Travel Case', ['il_fullxfull.5551234567_ab12.jpg'], 'publish', '', [new WooVariation(100, 'SKU-1', ['Color' => 'Red'], 1524, 'publish', 'instock')]);
        $plan = $this->plan($listing, $woo);
        $entry = $plan->entries[0];
        foreach (['title', 'description', 'images', 'variations', 'base_price', 'stock', 'listing_state'] as $field) {
            $this->assertSame(PlanItem::IN_SYNC, $this->item($plan, $field)->status, $field);
        }
        $this->assertFalse($entry->hasChanges());
        foreach (FieldPolicy::websiteOwned() as $field) {
            $this->assertSame(PlanItem::UNTOUCHED, $this->item($plan, $field)->status, $field);
        }
        $this->assertTrue($entry->approved);
    }

    public function testEtsyChangesToTitleDescriptionAndPriceAreProposedWithBeforeAndAfter(): void
    {
        $listing = Fixtures::listing(1, ['title' => 'New Etsy Title', 'description' => 'Fresh Etsy copy that is quite different from the old one.'], [[10, 'S', ['C' => 'x'], 1800]], [5551234567]);
        $woo = Fixtures::woo(10, 'Old Website Title', ['il_fullxfull.5551234567_ab12.jpg'], 'publish', '', [], 1524, 'Old website copy.');
        $plan = $this->plan($listing, $woo);

        $title = $this->item($plan, 'title');
        $this->assertSame(PlanItem::CHANGE, $title->status);
        $this->assertSame('Old Website Title', $title->before);
        $this->assertSame('New Etsy Title', $title->after);
        $this->assertSame('etsy', $title->owner);

        $price = $this->item($plan, 'base_price');
        $this->assertSame(PlanItem::CHANGE, $price->status);
        $this->assertSame(PlanItem::RISK_HIGH, $price->risk);
        $this->assertSame(['etsy_cents' => 1800, 'website_cents' => 1800, 'policy' => 'same as Etsy'], $price->after);
        $this->assertStringContains('Website $15.24 becomes $18.00', $price->note);
    }

    public function testSeparateEtsyAndWebsitePricesWhenConfigured(): void
    {
        $listing = Fixtures::listing(1, [], [[10, 'S', ['C' => 'x'], 1000]], [5551234567]);
        $woo = Fixtures::woo(10, 'Skip-Bo Card Game Travel Case', ['il_fullxfull.5551234567_ab12.jpg'], 'publish', '', [], 1100);
        $context = new PlanContext(pricePolicies: [10 => new PricePolicy(PricePolicy::MARKUP_PERCENT, 1000)]);
        $price = $this->item($this->plan($listing, $woo, $context), 'base_price');
        $this->assertSame(PlanItem::IN_SYNC, $price->status, 'Etsy $10.00 + 10% = the website\'s $11.00');
        $this->assertSame(1000, $price->after['etsy_cents']);
        $this->assertSame(1100, $price->after['website_cents']);

        $fixed = new PlanContext(pricePolicies: [10 => new PricePolicy(PricePolicy::FIXED, 1999)]);
        $this->assertSame(1999, $this->item($this->plan($listing, $woo, $fixed), 'base_price')->after['website_cents']);
    }

    public function testAnApprovedOverrideKeepsTheWebsiteValueAndSaysSo(): void
    {
        $listing = Fixtures::listing(1, ['title' => 'Etsy Title'], [[10, 'S', ['C' => 'x'], 1524]], [5551234567]);
        $woo = Fixtures::woo(10, 'Website SEO Title', ['il_fullxfull.5551234567_ab12.jpg']);
        $context = new PlanContext(overrides: [new Override(10, 'title', 'Keyword-optimized title', 'owner', '2026-10-14')]);
        $title = $this->item($this->plan($listing, $woo, $context), 'title');
        $this->assertSame(PlanItem::SKIPPED_OVERRIDE, $title->status);
        $this->assertSame('Etsy Title', $title->after, 'the Etsy value is still shown');
    }

    public function testThreeWayConflictsAndWebsiteEditsComeFromTheStoredBase(): void
    {
        $listing = Fixtures::listing(1, ['title' => 'Etsy New'], [[10, 'S', ['C' => 'x'], 1524]], [5551234567]);
        $woo = Fixtures::woo(10, 'Website New', ['il_fullxfull.5551234567_ab12.jpg']);
        $bases = [1 => ['title' => ConflictDetector::hash('Original')]];
        $this->assertSame(PlanItem::CONFLICT, $this->item($this->plan($listing, $woo, new PlanContext(bases: $bases)), 'title')->status);

        $unchangedOnEtsy = Fixtures::listing(1, ['title' => 'Original'], [[10, 'S', ['C' => 'x'], 1524]], [5551234567]);
        $this->assertSame(PlanItem::WEBSITE_EDIT, $this->item($this->plan($unchangedOnEtsy, $woo, new PlanContext(bases: $bases)), 'title')->status);
    }

    public function testImagesAreComparedByEtsyImageIdAndOnlyUnrecognizedOnesAreKept(): void
    {
        $listing = Fixtures::listing(1, [], [[10, 'S', ['C' => 'x'], 1524]], [111, 222, 333]);
        $woo = Fixtures::woo(10, 'Skip-Bo Card Game Travel Case', ['il_fullxfull.222_ab12.jpg', 'my-own-photo.jpg']);
        $images = $this->item($this->plan($listing, $woo), 'images');
        $this->assertSame(PlanItem::CHANGE, $images->status);
        $this->assertStringContains('2 Etsy image(s) would be added', $images->note);
        $this->assertStringContains('1 website image(s) cannot be traced to Etsy and would be kept', $images->note);
    }

    public function testBlankAnyVariationsGetSpecificValuesKeepingTheirIdsAndFlaggedHighRisk(): void
    {
        $listing = Fixtures::listing(1, [], [
            [9001, 'TAG-RED', ['Tag Color' => 'Red'], 899],
            [9002, 'TAG-BLUE', ['Tag Color' => 'Blue'], 899],
            [9003, 'TAG-NEW', ['Tag Color' => 'Green'], 899],
        ], [5551234567]);
        $woo = Fixtures::woo(10, 'Skip-Bo Card Game Travel Case', ['il_fullxfull.5551234567_ab12.jpg'], 'publish', '', [
            new WooVariation(501, 'tag-red', ['Tag Color' => ''], 899, 'publish', 'instock'),
            new WooVariation(502, 'TAG-BLUE', ['Tag Color' => ''], 899, 'publish', 'instock'),
            new WooVariation(503, 'OLD-ONLY', ['Tag Color' => ''], 899, 'publish', 'instock'),
        ]);
        $plan = $this->plan($listing, $woo);
        $item = $this->item($plan, 'variations');
        $this->assertSame(PlanItem::CHANGE, $item->status);
        $this->assertSame(PlanItem::RISK_HIGH, $item->risk);
        $summary = $plan->entries[0]->variations;
        $this->assertSame(2, $summary['matched']);
        $this->assertSame(2, $summary['attribute_changes']);
        $this->assertSame(1, $summary['to_create']);
        $this->assertSame(1, $summary['woo_only']);
        $byProduct = [];
        foreach ($summary['actions'] as $a) {
            $byProduct[$a['etsy_product_id']] = $a;
        }
        $this->assertSame(501, $byProduct[9001]['woo_variation_id'], 'matched by SKU, case-insensitively, keeping the Woo id');
        $this->assertSame('set_attributes', $byProduct[9001]['action']);
        $this->assertSame('create', $byProduct[9003]['action']);
        $this->assertStringContains('flagged, not deleted', $item->note);
    }

    public function testVariationsMatchByOptionValuesWhenSkusDifferAndStayInSyncWhenTheyAgree(): void
    {
        $listing = Fixtures::listing(1, [], [[9001, 'NEW-SKU', ['Tag Color' => 'Red'], 899]], [5551234567]);
        $woo = Fixtures::woo(10, 'Skip-Bo Card Game Travel Case', ['il_fullxfull.5551234567_ab12.jpg'], 'publish', '', [new WooVariation(501, 'OLD-SKU', ['Tag Color' => 'red'], 899, 'publish', 'instock')], 899);
        $plan = $this->plan($listing, $woo);
        $this->assertSame(501, $plan->entries[0]->variations['actions'][0]['woo_variation_id']);
        $this->assertSame('keep', $plan->entries[0]->variations['actions'][0]['action']);
    }

    public function testTurningASimpleProductIntoAVariableOneIsFlaggedAsAStructuralChange(): void
    {
        $listing = Fixtures::listing(1, [], [[1, 'A', ['C' => 'x'], 100], [2, 'B', ['C' => 'y'], 100]], [5551234567]);
        $woo = Fixtures::woo(10, 'Skip-Bo Card Game Travel Case', ['il_fullxfull.5551234567_ab12.jpg']);
        $item = $this->item($this->plan($listing, $woo), 'variations');
        $this->assertSame(PlanItem::RISK_HIGH, $item->risk);
        $this->assertStringContains('no variations but the listing has 2', $item->note);
    }

    public function testMadeToOrderIgnoresEtsyQuantityAndReportsSwitchedOffVariations(): void
    {
        $listing = Fixtures::listing(1, ['quantity' => 0], [[1, 'A', ['C' => 'x'], 100], [2, 'B', ['C' => 'y'], 100, false]], [5551234567]);
        $woo = new \KcPrintworks\Etsy\Woo\WooProduct(10, 'simple', 'publish', 'Skip-Bo Card Game Travel Case', 's', '', 'x', 100, 100, ['il_fullxfull.5551234567_ab12.jpg'], [], [], [], null, '', true);
        $stock = $this->item($this->plan($listing, $woo), 'stock');
        $this->assertSame(PlanItem::CHANGE, $stock->status, 'WooCommerce manages stock today, made to order would not');
        $this->assertSame(['policy' => 'made_to_order', 'manage_stock' => false, 'unavailable_variations' => 1], $stock->after);
        $this->assertStringContains('Etsy\'s quantity is ignored', $stock->note);
    }

    public function testPersonalizationInstructionsBecomeSuggestedStructuredFieldsNeverAutoActivated(): void
    {
        $listing = Fixtures::listing(1, ['is_personalizable' => true, 'personalization_is_required' => true, 'personalization_char_count_max' => 30, 'personalization_instructions' => 'Name / Emoji / Cable color'], [[1, 'A', ['C' => 'x'], 100]], [5551234567]);
        $item = $this->item($this->plan($listing, Fixtures::woo(10, 'Skip-Bo Card Game Travel Case', ['il_fullxfull.5551234567_ab12.jpg'])), 'personalization');
        $this->assertSame(PlanItem::SUGGESTION, $item->status);
        $this->assertSame(['Name', 'Emoji', 'Cable color'], $item->after['suggested_fields']);
        $this->assertTrue($item->after['required']);
        $this->assertSame(30, $item->after['max_chars']);
        $this->assertStringContains('only a starting point', $item->note);
    }

    public function testAnInactiveEtsyListingIsFlaggedNotActedOn(): void
    {
        $listing = Fixtures::listing(1, ['state' => 'sold_out'], [[1, 'A', ['C' => 'x'], 100]], [5551234567]);
        $item = $this->item($this->plan($listing, Fixtures::woo(10, 'Skip-Bo Card Game Travel Case', ['il_fullxfull.5551234567_ab12.jpg'])), 'listing_state');
        $this->assertSame(PlanItem::FLAG, $item->status);
        $this->assertStringContains('Nothing is unpublished automatically', $item->note);
    }

    public function testNewListingsBecomeDraftsOnlyAndLeaveUrlAndCategoriesToTheOwner(): void
    {
        $listing = Fixtures::listing(1, ['title' => 'Brand new', 'description' => 'Entirely novel words nobody has used before today.'], [[1, 'A', ['C' => 'x'], 1000]], [5551234567]);
        $report = (new Matcher())->match([$listing], []);
        $plan = (new Planner())->plan($report, new PlanContext());
        $entry = $plan->entries[0];
        $this->assertSame(PlanEntry::CREATE_DRAFT, $entry->action);
        $this->assertFalse($entry->approved, 'a new product needs the owner to approve creating it');
        $this->assertNull($entry->wooId);
        $slug = $entry->items[count($entry->items) - 1];
        $this->assertSame('slug', $slug->field);
        $this->assertStringContains('DRAFT', $slug->note);
    }

    public function testUnapprovedMatchesArePreviewedButNotMarkedApprovedAndIgnoredListingsAreSkipped(): void
    {
        $listing = Fixtures::listing(1);
        $woo = Fixtures::woo(10);
        $plan = $this->plan($listing, $woo, null, false);
        $this->assertFalse($plan->entries[0]->approved);
        $this->assertSame(1, $plan->totals()['preview_only']);

        $report = (new Matcher())->match([$listing], [$woo], [], [1 => new Decision(1, Decision::IGNORE)]);
        $this->assertCount(0, (new Planner())->plan($report, new PlanContext())->entries);
    }

    public function testThePlanHashIsStableAndChangesWithTheData(): void
    {
        $listing = Fixtures::listing(1, [], [[1, 'A', ['C' => 'x'], 1524]], [5551234567]);
        $woo = Fixtures::woo(10, 'Skip-Bo Card Game Travel Case', ['il_fullxfull.5551234567_ab12.jpg']);
        $a = $this->plan($listing, $woo)->hash();
        $this->assertSame($a, $this->plan($listing, $woo)->hash());
        $changed = Fixtures::listing(1, ['title' => 'Different'], [[1, 'A', ['C' => 'x'], 1524]], [5551234567]);
        $this->assertTrue($a !== $this->plan($changed, $woo)->hash());
    }
}
