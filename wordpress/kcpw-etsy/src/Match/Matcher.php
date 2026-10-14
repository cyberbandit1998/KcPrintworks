<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Match;

use KcPrintworks\Etsy\Model\Listing;
use KcPrintworks\Etsy\Woo\Text;
use KcPrintworks\Etsy\Woo\WooProduct;

/**
 * Matches Etsy listings to existing WooCommerce products by evidence. It only READS and REPORTS.
 *
 * Rules (docs/ETSY-INTEGRATION.md section 6):
 *  - A match is "proposed" only on strong, identifier-like evidence (stored Etsy id, an Etsy id inside a SKU, an exact
 *    unique SKU, a shared Etsy image id). Titles, descriptions, and prices can corroborate but never decide.
 *  - Two or more products with strong evidence (the duplicate imports) are ambiguous: the owner picks, the matcher only suggests.
 *  - One Woo product claimed by two listings is ambiguous for both.
 *  - Owner decisions are applied last and win, but an invalid one is reported, not obeyed.
 */
final class Matcher
{
    private const TITLE_SIMILAR_THRESHOLD = 0.8;
    private const DESCRIPTION_SIMILAR_THRESHOLD = 0.85;

    /**
     * @param list<Listing> $listings
     * @param list<WooProduct> $products
     * @param array<int,int> $existingMap Etsy listing id => Woo product id (permanent mappings already stored)
     * @param array<int,Decision> $decisions
     */
    public function match(array $listings, array $products, array $existingMap = [], array $decisions = []): MatchReport
    {
        $wooById = [];
        foreach ($products as $product) {
            $wooById[$product->id] = $product;
        }
        $index = $this->index($products);
        $etsySkuCounts = [];
        foreach ($listings as $listing) {
            foreach ($listing->skus() as $sku) {
                $key = strtolower($sku);
                $etsySkuCounts[$key] = ($etsySkuCounts[$key] ?? 0) + 1;
            }
        }

        $entries = [];
        foreach ($listings as $listing) {
            $entries[] = $this->classify($listing, $wooById, $index, $etsySkuCounts, $existingMap);
        }

        $this->flagSharedClaims($entries);
        $this->applyDecisions($entries, $wooById, $decisions);

        $claimed = [];
        foreach ($entries as $entry) {
            if ($entry->wooId !== null) {
                $claimed[$entry->wooId] = true;
            }
            foreach ($entry->candidates as $candidate) {
                if ($candidate->strong()) {
                    $claimed[$candidate->wooId] = true;
                }
            }
        }
        $wooOnly = array_values(array_filter($products, static fn (WooProduct $p): bool => !isset($claimed[$p->id])));

        return new MatchReport($entries, $wooOnly, $wooById);
    }

    /**
     * @param list<WooProduct> $products
     * @return array<string,mixed>
     */
    private function index(array $products): array
    {
        $index = ['stored' => [], 'sku' => [], 'num' => [], 'img' => [], 'titles' => []];
        foreach ($products as $product) {
            if ($product->etsyListingId !== null) {
                $index['stored'][$product->etsyListingId][] = $product->id;
            }
            foreach ($product->skus() as $sku) {
                $index['sku'][strtolower($sku)][$product->id] = true;
                foreach (Text::longNumbers($sku) as $number) {
                    $index['num'][$number][$product->id] = true;
                }
            }
            foreach ($product->imageFilenames as $file) {
                $id = Text::etsyImageId($file);
                if ($id !== null) {
                    $index['img'][$id][$product->id] = true;
                }
            }
            $index['titles'][$product->id] = [
                'words' => Text::words($product->title),
                'set' => array_values(array_unique(explode(' ', Text::words($product->title)))),
                'shingles' => Text::shingles($product->description),
            ];
        }
        return $index;
    }

    /**
     * @param array<int,WooProduct> $wooById
     * @param array<string,mixed> $index
     * @param array<string,int> $etsySkuCounts
     * @param array<int,int> $existingMap
     */
    private function classify(Listing $listing, array $wooById, array $index, array $etsySkuCounts, array $existingMap): Entry
    {
        /** @var array<int,list<Signal>> $signals */
        $signals = [];
        $add = static function (int $wooId, Signal $signal) use (&$signals): void {
            $signals[$wooId][] = $signal;
        };

        // 1. Permanent mapping (table) or a stored Etsy id in Woo meta.
        if (isset($existingMap[$listing->id])) {
            $mapped = $existingMap[$listing->id];
            if (!isset($wooById[$mapped])) {
                return new Entry($listing, Entry::MAPPED_MISSING, [], $mapped, '', null, [sprintf('Mapped to WooCommerce product #%d, which no longer exists.', $mapped)]);
            }
            return new Entry($listing, Entry::MAPPED, [new Candidate($mapped, [new Signal(Signal::STORED_ID, 100, 'permanent mapping')], 100)], $mapped);
        }
        foreach ($index['stored'][$listing->id] ?? [] as $wooId) {
            $add($wooId, new Signal(Signal::STORED_ID, 100, 'Etsy listing id stored on the product'));
        }

        // 2. Etsy ids inside Woo SKUs.
        foreach (array_keys($index['num'][(string) $listing->id] ?? []) as $wooId) {
            $add($wooId, new Signal(Signal::LISTING_ID_IN_SKU, 90, 'listing id ' . $listing->id . ' appears in a SKU'));
        }
        foreach ($listing->variants as $variant) {
            foreach (array_keys($index['num'][(string) $variant->productId] ?? []) as $wooId) {
                $add($wooId, new Signal(Signal::PRODUCT_ID_IN_SKU, 90, 'inventory product id ' . $variant->productId . ' appears in a SKU'));
            }
        }

        // 3. Exact SKU, only where unique on both sides.
        foreach ($listing->skus() as $sku) {
            $key = strtolower($sku);
            $owners = array_keys($index['sku'][$key] ?? []);
            if (count($owners) === 1 && ($etsySkuCounts[$key] ?? 0) === 1) {
                $add($owners[0], new Signal(Signal::SKU_EXACT, 85, 'SKU "' . $sku . '" is unique on both sides'));
            }
        }

        // 4. Shared Etsy image ids (the images were uploaded from Etsy and keep its file name).
        $imageHits = [];
        foreach ($listing->imageIds() as $imageId) {
            foreach (array_keys($index['img'][$imageId] ?? []) as $wooId) {
                $imageHits[$wooId] = ($imageHits[$wooId] ?? 0) + 1;
            }
        }
        foreach ($imageHits as $wooId => $hits) {
            $total = max(1, count($listing->images));
            $add($wooId, new Signal(Signal::IMAGE_ID, $hits * 2 >= $total ? 90 : 85, sprintf('%d of %d Etsy images are on the product', $hits, $total)));
        }

        // 5. Weak, corroborating evidence for every product.
        $titleWords = Text::words($listing->title);
        $titleSet = array_values(array_unique(explode(' ', $titleWords)));
        $descShingles = Text::shingles($listing->description);
        $etsyCents = $listing->basePrice()?->toCents();
        foreach ($wooById as $wooId => $product) {
            $t = $index['titles'][$wooId];
            if ($t['words'] !== '' && $t['words'] === $titleWords) {
                $add($wooId, new Signal(Signal::TITLE_EXACT, 60, 'same title'));
            } elseif (Text::jaccard($titleSet, $t['set']) >= self::TITLE_SIMILAR_THRESHOLD) {
                $add($wooId, new Signal(Signal::TITLE_SIMILAR, 40, 'very similar title'));
            }
            if ($descShingles !== [] && $t['shingles'] !== [] && Text::jaccard($descShingles, $t['shingles']) >= self::DESCRIPTION_SIMILAR_THRESHOLD) {
                $add($wooId, new Signal(Signal::DESCRIPTION_SIMILAR, 20, 'same description'));
            }
            if ($etsyCents !== null && ($product->priceCents === $etsyCents || $this->hasVariationPrice($product, $etsyCents))) {
                $add($wooId, new Signal(Signal::PRICE_EQUAL, 5, 'same price'));
            }
        }

        $candidates = [];
        foreach ($signals as $wooId => $list) {
            // Price and description alone are not evidence of anything.
            $types = array_map(static fn (Signal $s): string => $s->type, $list);
            if (array_diff($types, [Signal::PRICE_EQUAL, Signal::DESCRIPTION_SIMILAR]) === []) {
                continue;
            }
            $candidates[] = new Candidate($wooId, $list, $this->score($list));
        }
        usort($candidates, fn (Candidate $a, Candidate $b): int => [$b->score, $a->wooId] <=> [$a->score, $b->wooId]);

        $strong = array_values(array_filter($candidates, static fn (Candidate $c): bool => $c->strong()));
        // Other products that are, by their words, the same item: an identical title (however the description reads), or
        // a similar title with the same description. These are the duplicate imports. Even beside a product with
        // identifier evidence they make the match ambiguous: two products with one title are the owner's decision.
        $twins = array_values(array_filter($candidates, fn (Candidate $c): bool => $this->twin($c)));

        if (count($strong) === 1 && $twins === []) {
            return new Entry($listing, Entry::PROPOSED, $candidates, $strong[0]->wooId, '', null, [], [], Entry::EVIDENCE_IDENTIFIER);
        }
        if (count($strong) + count($twins) >= 2 && ($strong !== [] || count($twins) >= 2)) {
            $pool = array_merge($strong, $twins);
            $suggested = $this->suggestKeeper($pool, $wooById);
            return new Entry($listing, Entry::AMBIGUOUS, $candidates, null, Entry::REASON_DUPLICATES, $suggested[0], [$suggested[1]]);
        }
        if ($strong === [] && count($twins) === 1 && $this->textualMatch($twins[0])) {
            return new Entry($listing, Entry::PROPOSED, $candidates, $twins[0]->wooId, '', null, ['No identifier links this product to the listing: the title and description are the same. Review it before approving.'], [], Entry::EVIDENCE_TEXTUAL);
        }
        if ($candidates !== []) {
            return new Entry($listing, Entry::AMBIGUOUS, $candidates, null, Entry::REASON_TITLE_ONLY, null, ['Only titles (and possibly prices) agree. A title is never enough to link a product: choose one yourself.']);
        }
        return new Entry($listing, Entry::NEW);
    }

    /** @param list<Signal> $signals */
    private function score(array $signals): int
    {
        $strongBest = 0;
        $weakSum = 0;
        $hasStrong = false;
        foreach ($signals as $signal) {
            if ($signal->strong()) {
                $hasStrong = true;
                $strongBest = max($strongBest, $signal->weight);
            } else {
                $weakSum += $signal->weight;
            }
        }
        return $hasStrong ? min(100, $strongBest + (int) floor($weakSum / 4)) : min(85, $weakSum);
    }

    private function hasVariationPrice(WooProduct $product, int $cents): bool
    {
        foreach ($product->variations as $variation) {
            if ($variation->priceCents === $cents) {
                return true;
            }
        }
        return false;
    }

    /**
     * Among several products that all describe the same Etsy listing (duplicate imports), a SUGGESTION for which one
     * the listing should map to. Published beats draft, then the oldest (lowest id), because the older copy is the one
     * most likely to hold the website's URL, SEO, and reviews. Sales, reviews, and URLs are not visible here, so this
     * is a starting point: the owner decides.
     * @param list<Candidate> $pool
     * @param array<int,WooProduct> $wooById
     * @return array{0:int,1:string}
     */
    private function suggestKeeper(array $pool, array $wooById): array
    {
        usort($pool, static function (Candidate $a, Candidate $b) use ($wooById): int {
            return [(int) !$wooById[$a->wooId]->published(), $a->wooId] <=> [(int) !$wooById[$b->wooId]->published(), $b->wooId];
        });
        $best = $pool[0];
        $why = sprintf(
            'Suggested: #%d (%s, oldest of %d matching products). Sales history, reviews, and URLs are not visible here, so this is a starting point: you decide. The others would be redirected later, never deleted by this plugin.',
            $best->wooId,
            $wooById[$best->wooId]->published() ? 'published' : $wooById[$best->wooId]->status,
            count($pool),
        );
        return [$best->wooId, $why];
    }

    /** Reads like the same item without identifier evidence (see classify). */
    private function twin(Candidate $candidate): bool
    {
        if ($candidate->strong()) {
            return false;
        }
        $types = $candidate->signalTypes();
        return in_array(Signal::TITLE_EXACT, $types, true)
            || (in_array(Signal::TITLE_SIMILAR, $types, true) && in_array(Signal::DESCRIPTION_SIMILAR, $types, true));
    }

    /** Title (exact or very similar) AND the same description: enough to PROPOSE, never to decide. */
    private function textualMatch(Candidate $candidate): bool
    {
        $types = $candidate->signalTypes();
        return !$candidate->strong()
            && (in_array(Signal::TITLE_EXACT, $types, true) || in_array(Signal::TITLE_SIMILAR, $types, true))
            && in_array(Signal::DESCRIPTION_SIMILAR, $types, true);
    }

    /** @param list<Entry> $entries */
    private function flagSharedClaims(array $entries): void
    {
        $claims = [];
        foreach ($entries as $entry) {
            if ($entry->status === Entry::PROPOSED && $entry->wooId !== null) {
                $claims[$entry->wooId][] = $entry;
            }
        }
        foreach ($claims as $wooId => $claimants) {
            if (count($claimants) < 2) {
                continue;
            }
            foreach ($claimants as $entry) {
                $entry->status = Entry::AMBIGUOUS;
                $entry->reason = Entry::REASON_CLAIMED;
                $entry->suggestedWooId = $wooId;
                $entry->wooId = null;
                $entry->notes[] = sprintf('WooCommerce product #%d is claimed by %d Etsy listings. One product can map to only one listing.', $wooId, count($claimants));
            }
        }
    }

    /**
     * @param list<Entry> $entries
     * @param array<int,WooProduct> $wooById
     * @param array<int,Decision> $decisions
     */
    private function applyDecisions(array $entries, array $wooById, array $decisions): void
    {
        foreach ($entries as $entry) {
            $decision = $decisions[$entry->listing->id] ?? null;
            if ($decision === null) {
                continue;
            }
            if ($decision->type === Decision::IGNORE) {
                $entry->status = Entry::IGNORED;
                $entry->wooId = null;
                continue;
            }
            if ($decision->type === Decision::CREATE_NEW) {
                $entry->status = Entry::APPROVED_NEW;
                $entry->wooId = null;
                continue;
            }
            if (!isset($wooById[$decision->wooProductId])) {
                $entry->notes[] = sprintf('Your decision points to WooCommerce product #%d, which does not exist. It was not applied.', $decision->wooProductId);
                $entry->reason = Entry::REASON_INVALID_DECISION;
                continue;
            }
            $entry->status = Entry::APPROVED;
            $entry->wooId = $decision->wooProductId;
            $entry->reason = '';
            $entry->unlinkedDuplicates = [];
            foreach ($entry->candidates as $candidate) {
                if ($candidate->wooId !== $decision->wooProductId && ($candidate->strong() || $this->twin($candidate))) {
                    $entry->unlinkedDuplicates[] = $candidate->wooId;
                }
            }
        }
    }
}
