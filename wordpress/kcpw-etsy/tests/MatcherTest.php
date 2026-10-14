<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Tests;

use KcPrintworks\Etsy\Match\ArrayDecisionStore;
use KcPrintworks\Etsy\Match\Decision;
use KcPrintworks\Etsy\Match\Entry;
use KcPrintworks\Etsy\Match\Matcher;
use KcPrintworks\Etsy\Match\Signal;
use KcPrintworks\Etsy\Woo\WooVariation;

final class MatcherTest extends TestCase
{
    private function run(array $listings, array $products, array $map = [], array $decisions = []): \KcPrintworks\Etsy\Match\MatchReport
    {
        return (new Matcher())->match($listings, $products, $map, $decisions);
    }

    public function testASharedEtsyImageIdProposesAMatchEvenWhenTheTitlesDiffer(): void
    {
        $listing = Fixtures::listing(1, ['title' => 'Completely different new title'], [], [5551234567, 5551234568]);
        $woo = Fixtures::woo(10, 'Old website title', ['il_fullxfull.5551234567_ab12.jpg']);
        $entry = $this->run([$listing], [$woo])->entries[0];
        $this->assertSame(Entry::PROPOSED, $entry->status);
        $this->assertSame(10, $entry->wooId);
        $this->assertSame(Entry::EVIDENCE_IDENTIFIER, $entry->evidence);
        $this->assertContains(Signal::IMAGE_ID, $entry->candidates[0]->signalTypes());
    }

    public function testAnEtsyIdInsideAWooSkuIsStrongEvidence(): void
    {
        $listing = Fixtures::listing(1234567890, [], [[40001, 'OTHER', ['C' => 'x'], 100]]);
        $woo = Fixtures::woo(10, 'Unrelated', [], 'publish', '1234567890_AB12');
        $entry = $this->run([$listing], [$woo])->entries[0];
        $this->assertSame(Entry::PROPOSED, $entry->status);
        $this->assertContains(Signal::LISTING_ID_IN_SKU, $entry->candidates[0]->signalTypes());

        $byProductId = $this->run([Fixtures::listing(2, [], [[98765432101, 'X', ['C' => 'x'], 100]])], [Fixtures::woo(11, 'Unrelated', [], 'publish', '', [new WooVariation(1, '98765432101_ZZ', [], 100, 'publish', 'instock')])])->entries[0];
        $this->assertSame(Entry::PROPOSED, $byProductId->status);
        $this->assertContains(Signal::PRODUCT_ID_IN_SKU, $byProductId->candidates[0]->signalTypes());
    }

    public function testASkuMatchCountsOnlyWhenUniqueOnBothSides(): void
    {
        $listing = Fixtures::listing(1, [], [[100, 'CASE-1', ['C' => 'x'], 100]]);
        $unique = $this->run([$listing], [Fixtures::woo(10, 'Other', [], 'publish', 'case-1')])->entries[0];
        $this->assertSame(Entry::PROPOSED, $unique->status);

        $twice = $this->run([$listing], [Fixtures::woo(10, 'Other', [], 'publish', 'CASE-1'), Fixtures::woo(11, 'Another', [], 'publish', 'CASE-1')])->entries[0];
        $this->assertSame(Entry::NEW, $twice->status, 'a SKU shared by two Woo products proves nothing');

        $sharedOnEtsy = $this->run([$listing, Fixtures::listing(2, [], [[200, 'CASE-1', ['C' => 'y'], 100]])], [Fixtures::woo(10, 'Other', [], 'publish', 'CASE-1')]);
        $this->assertSame(Entry::NEW, $sharedOnEtsy->entries[0]->status);
    }

    public function testATitleAloneNeverProposesAMatch(): void
    {
        $listing = Fixtures::listing(1, ['description' => 'Totally rewritten description with different words entirely here.']);
        $woo = Fixtures::woo(10, 'Skip-Bo Card Game Travel Case', [], 'publish', '', [], 1524, 'Old copy that shares nothing with the Etsy text at all really.');
        $entry = $this->run([$listing], [$woo])->entries[0];
        $this->assertSame(Entry::AMBIGUOUS, $entry->status);
        $this->assertSame(Entry::REASON_TITLE_ONLY, $entry->reason);
        $this->assertNull($entry->wooId);
        $this->assertFalse($entry->candidates[0]->strong());
    }

    public function testSameTitleAndDescriptionIsAProposalMarkedTextualNotIdentifier(): void
    {
        $entry = $this->run([Fixtures::listing(1)], [Fixtures::woo(10)])->entries[0];
        $this->assertSame(Entry::PROPOSED, $entry->status);
        $this->assertSame(Entry::EVIDENCE_TEXTUAL, $entry->evidence);
        $this->assertStringContains('Review it before approving', $entry->notes[0]);
    }

    public function testDuplicateImportsAreAmbiguousWithAKeeperSuggestionAndNoAutomaticChoice(): void
    {
        $listing = Fixtures::listing(1, [], [], [5551234567]);
        $curated = Fixtures::woo(30, 'Skip-Bo Card Game Travel Case', ['custom-photo-1.jpg']);
        $reimport = Fixtures::woo(900, 'Skip-Bo Card Game Travel Case', ['il_fullxfull.5551234567_ab12.jpg']);
        $draft = Fixtures::woo(24, 'Skip-Bo Card Game Travel Case', [], 'draft');
        $entry = $this->run([$listing], [$reimport, $curated, $draft])->entries[0];

        $this->assertSame(Entry::AMBIGUOUS, $entry->status);
        $this->assertSame(Entry::REASON_DUPLICATES, $entry->reason);
        $this->assertNull($entry->wooId, 'the matcher never picks a winner');
        $this->assertSame(30, $entry->suggestedWooId, 'published beats draft, then the oldest published id');
        $this->assertCount(3, $entry->candidates);
        $this->assertStringContains('you decide', $entry->notes[0]);
    }

    public function testTwoListingsClaimingTheSameWooProductBothBecomeAmbiguous(): void
    {
        $a = Fixtures::listing(1, ['title' => 'Alpha'], [], [5550000001]);
        $b = Fixtures::listing(2, ['title' => 'Beta'], [], [5550000002]);
        $woo = Fixtures::woo(10, 'Gamma', ['il_fullxfull.5550000001_aa11.jpg', 'il_fullxfull.5550000002_bb22.jpg']);
        $report = $this->run([$a, $b], [$woo]);
        foreach ($report->entries as $entry) {
            $this->assertSame(Entry::AMBIGUOUS, $entry->status);
            $this->assertSame(Entry::REASON_CLAIMED, $entry->reason);
        }
    }

    public function testPermanentMappingsAndStoredIdsWinAndMissingTargetsAreReported(): void
    {
        $report = $this->run([Fixtures::listing(1), Fixtures::listing(2), Fixtures::listing(3)], [Fixtures::woo(10, 'A'), Fixtures::woo(11, 'B', [], 'publish', '', [], 100, 'x', 3)], [1 => 10, 2 => 999]);
        $this->assertSame(Entry::MAPPED, $report->entries[0]->status);
        $this->assertSame(Entry::MAPPED_MISSING, $report->entries[1]->status);
        $this->assertSame(Entry::PROPOSED, $report->entries[2]->status, 'stored id on the product proposes the link');
        $this->assertContains(Signal::STORED_ID, $report->entries[2]->candidates[0]->signalTypes());
    }

    public function testNothingCredibleMeansNewAndUnclaimedWooProductsAreListed(): void
    {
        $report = $this->run([Fixtures::listing(1, ['title' => 'Brand new thing', 'description' => 'Nothing alike at all, entirely different words.'])], [Fixtures::woo(10, 'Battery box', [], 'publish', '', [], 900, 'About batteries only, no overlap whatsoever.')]);
        $this->assertSame(Entry::NEW, $report->entries[0]->status);
        $this->assertCount(1, $report->wooOnly);
        $this->assertSame(10, $report->wooOnly[0]->id);
        $this->assertSame(1, $report->counts()[Entry::NEW]);
    }

    public function testPriceAndDescriptionAloneAreNotEvidence(): void
    {
        $listing = Fixtures::listing(1, ['title' => 'Alpha widget']);
        $woo = Fixtures::woo(10, 'Zeta gadget'); // same description and price, nothing else
        $this->assertSame(Entry::NEW, $this->run([$listing], [$woo])->entries[0]->status);
    }

    public function testOwnerDecisionsAreAppliedAndInvalidOnesAreReportedNotObeyed(): void
    {
        $listing = Fixtures::listing(1, [], [], [5551234567]);
        $products = [Fixtures::woo(30), Fixtures::woo(900, 'Skip-Bo Card Game Travel Case', ['il_fullxfull.5551234567_ab12.jpg'])];
        $store = new ArrayDecisionStore();

        $store->save(new Decision(1, Decision::LINK, 30, 'owner', '2026-10-14'));
        $entry = $this->run([$listing], $products, [], $store->all())->entries[0];
        $this->assertSame(Entry::APPROVED, $entry->status);
        $this->assertSame(30, $entry->wooId);
        $this->assertSame([900], $entry->unlinkedDuplicates, 'the other copy is reported as a retirement candidate, nothing is changed');

        $store->save(new Decision(1, Decision::LINK, 77777));
        $bad = $this->run([$listing], $products, [], $store->all())->entries[0];
        $this->assertSame(Entry::AMBIGUOUS, $bad->status);
        $this->assertSame(Entry::REASON_INVALID_DECISION, $bad->reason);

        $store->save(new Decision(1, Decision::IGNORE));
        $this->assertSame(Entry::IGNORED, $this->run([$listing], $products, [], $store->all())->entries[0]->status);
        $store->save(new Decision(1, Decision::CREATE_NEW));
        $this->assertSame(Entry::APPROVED_NEW, $this->run([$listing], $products, [], $store->all())->entries[0]->status);
        $this->assertThrows(\InvalidArgumentException::class, fn () => new Decision(1, Decision::LINK, null));
        $this->assertThrows(\InvalidArgumentException::class, fn () => new Decision(1, 'delete', 5));
    }

    public function testAllSettledOnlyWhenNothingIsLeftForTheOwner(): void
    {
        $listing = Fixtures::listing(1, [], [], [5551234567]);
        $products = [Fixtures::woo(30), Fixtures::woo(900, 'Skip-Bo Card Game Travel Case', ['il_fullxfull.5551234567_ab12.jpg'])];
        $this->assertFalse($this->run([$listing], $products)->allSettled());
        $decisions = [1 => new Decision(1, Decision::LINK, 30)];
        $this->assertTrue($this->run([$listing], $products, [], $decisions)->allSettled());
    }
}
