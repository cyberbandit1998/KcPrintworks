<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Tests;

use KcPrintworks\Etsy\Etsy\Normalizer;
use KcPrintworks\Etsy\Match\Entry;
use KcPrintworks\Etsy\Match\Matcher;
use KcPrintworks\Etsy\Model\Listing;
use KcPrintworks\Etsy\Report\MatchCsv;
use KcPrintworks\Etsy\Sync\PlanContext;
use KcPrintworks\Etsy\Sync\Planner;
use KcPrintworks\Etsy\Woo\CsvExportReader;
use KcPrintworks\Etsy\Woo\Text;
use KcPrintworks\Etsy\Woo\WooProduct;

/**
 * Runs the matcher and planner over the owner's REAL WooCommerce export (gitignored; skipped where it is absent, such
 * as CI) against SYNTHETIC Etsy listings derived from it. This is not Etsy data: it only proves that the duplicate
 * structure of the real catalog (15 duplicate title groups) is reported as "ambiguous" and never resolved silently.
 */
final class RealCatalogTest extends TestCase
{
    private const EXPORT = __DIR__ . '/../../../docs/discovery/raw/products.csv';

    /** @return list<WooProduct> */
    private function products(): array
    {
        if (!is_file(self::EXPORT)) {
            $this->skip('the product export is not present');
        }
        return CsvExportReader::fromFile(self::EXPORT)->products();
    }

    /**
     * One synthetic listing per distinct title. Etsy image ids come from the copy whose files still carry Etsy names.
     * @param list<WooProduct> $products
     * @return array{0:list<Listing>,1:array<string,list<WooProduct>>}
     */
    private function synthesize(array $products): array
    {
        $groups = [];
        foreach ($products as $p) {
            $groups[Text::words($p->title)][] = $p;
        }
        $listings = [];
        $id = 7_000_000_000;
        foreach ($groups as $members) {
            $imageIds = [];
            foreach ($members as $m) {
                foreach ($m->imageFilenames as $file) {
                    $etsyId = Text::etsyImageId($file);
                    if ($etsyId !== null) {
                        $imageIds[$etsyId] = true;
                    }
                }
            }
            $first = $members[0];
            $listings[] = (new Normalizer())->normalize(
                Fixtures::rawListing(++$id, ['title' => $first->title, 'description' => $first->description, 'price' => ['amount' => $first->priceCents ?? 0, 'divisor' => 100, 'currency_code' => 'USD']]),
                null,
                Fixtures::rawImages(array_keys($imageIds)),
            );
        }
        return [$listings, $groups];
    }

    public function testEveryDuplicateTitleGroupIsAmbiguousAndNothingIsChosenAutomatically(): void
    {
        $products = $this->products();
        [$listings, $groups] = $this->synthesize($products);
        $duplicateGroups = count(array_filter($groups, static fn (array $m): bool => count($m) > 1));
        $this->assertSame(15, $duplicateGroups, 'the export has 15 duplicate title groups');

        $report = (new Matcher())->match($listings, $products);
        $ambiguous = array_filter($report->entries, static fn (Entry $e): bool => $e->status === Entry::AMBIGUOUS);
        // Every duplicate group needs the owner. A near-duplicate with a similar title and the same description (Taco Cat
        // double deck, #652, beside the Taco Cat group) is reported the same way, so the count can exceed the groups.
        $this->assertTrue(count($ambiguous) >= $duplicateGroups, 'every duplicate group needs the owner');
        foreach ($groups as $members) {
            if (count($members) > 1) {
                $listing = null;
                foreach ($report->entries as $entry) {
                    foreach ($entry->candidates as $c) {
                        if ($c->wooId === $members[0]->id && in_array($entry->status, [Entry::AMBIGUOUS], true)) {
                            $listing = $entry;
                        }
                    }
                }
                $this->assertTrue($listing !== null, 'duplicate group of #' . $members[0]->id . ' is ambiguous');
            }
        }
        foreach ($ambiguous as $entry) {
            $this->assertNull($entry->wooId);
            $this->assertTrue($entry->suggestedWooId !== null, 'each ambiguity carries a suggestion');
            $this->assertTrue(count($entry->candidates) >= 2);
        }
        foreach ($report->entries as $entry) {
            if ($entry->status === Entry::PROPOSED) {
                $this->assertSame(1, count(array_filter($entry->candidates, static fn ($c): bool => $c->wooId === $entry->wooId)));
            }
        }
        $counts = $report->counts();
        $this->assertSame(count($listings), $counts['listings']);
        $this->assertSame(0, $counts[Entry::NEW], 'every synthetic listing derives from a real product, so none is new');
    }

    public function testThePlanForTheRealBagTagFlagsItsBlankVariationsAsAHighRiskStructuralFinding(): void
    {
        $products = $this->products();
        $bag = null;
        foreach ($products as $p) {
            if ($p->id === 889) {
                $bag = $p;
            }
        }
        $this->assertTrue($bag !== null);
        // An Etsy-side bag tag: 169 variants (13 x 13), each with a specific colour pair, SKUs equal to the Woo SKUs.
        $inventory = [];
        foreach ($bag->variations as $i => $variation) {
            $inventory[] = [90_000 + $i, $variation->sku, ['Tag Color' => 'Tag ' . intdiv($i, 13), 'Text Color' => 'Text ' . ($i % 13)], $variation->priceCents ?? 899];
        }
        $listing = (new Normalizer())->normalize(Fixtures::rawListing(7_100_000_001, ['title' => $bag->title, 'description' => $bag->description]), Fixtures::rawInventory($inventory), Fixtures::rawImages([]));

        $report = (new Matcher())->match([$listing], $products, [7_100_000_001 => 889]);
        $plan = (new Planner())->plan($report, new PlanContext());
        $summary = $plan->entries[0]->variations;
        $this->assertSame(169, $summary['etsy_variants']);
        $this->assertSame(169, $summary['matched'], 'the 169 Woo variations are matched by SKU and keep their ids');
        $this->assertSame(169, $summary['attribute_changes'], 'all 169 are blank ("Any") today and would get specific values');
        $this->assertSame(0, $summary['to_create']);
        foreach ($plan->entries[0]->items as $item) {
            if ($item->field === 'variations') {
                $this->assertSame('high', $item->risk);
            }
        }
    }

    public function testTheCsvReportRoundTripsOwnerDecisionsWithoutChangingAnything(): void
    {
        $products = $this->products();
        [$listings] = $this->synthesize($products);
        $report = (new Matcher())->match($listings, $products);
        $csv = MatchCsv::render($report);
        $this->assertSame(count($listings) + 1, count(array_filter(str_getcsv_lines($csv))), 'one row per listing plus the header');

        $ambiguous = array_values(array_filter($report->entries, static fn (Entry $e): bool => $e->status === Entry::AMBIGUOUS));
        $first = $ambiguous[0];
        $edited = preg_replace('/^(' . $first->listing->id . ',.*),,$/m', '$1,link,' . $first->suggestedWooId, $csv);
        $decisions = MatchCsv::parseDecisions((string) $edited, 'owner', '2026-10-14');
        $this->assertCount(1, $decisions);
        $this->assertSame($first->suggestedWooId, $decisions[0]->wooProductId);

        $again = (new Matcher())->match($listings, $products, [], [$decisions[0]->etsyListingId => $decisions[0]]);
        $this->assertSame(Entry::APPROVED, $again->entryFor($first->listing->id)->status);
    }
}

/** @return list<string> */
function str_getcsv_lines(string $csv): array
{
    $stream = fopen('php://temp', 'r+');
    fwrite($stream, $csv);
    rewind($stream);
    $rows = [];
    while (($row = fgetcsv($stream, 0, ',', '"', '')) !== false) {
        $rows[] = implode(',', $row);
    }
    return $rows;
}
