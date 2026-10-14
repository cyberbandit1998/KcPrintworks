<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Sync;

use KcPrintworks\Etsy\Match\Entry;
use KcPrintworks\Etsy\Match\MatchReport;
use KcPrintworks\Etsy\Model\Listing;
use KcPrintworks\Etsy\Model\Variant;
use KcPrintworks\Etsy\Woo\Text;
use KcPrintworks\Etsy\Woo\WooProduct;
use KcPrintworks\Etsy\Woo\WooVariation;

/**
 * Dry-run planner: compares each matched Etsy listing with its WooCommerce product under the field policy and says what
 * a synchronization would change. It reads, compares, and describes. It has no way to write: there is no WooCommerce
 * write call anywhere in this plugin in the read-only phase (tests/ReadOnlySafetyTest.php enforces that).
 */
final class Planner
{
    public function plan(MatchReport $report, PlanContext $context): Plan
    {
        $entries = [];
        foreach ($report->entries as $entry) {
            if ($entry->status === Entry::IGNORED) {
                continue;
            }
            $woo = $entry->wooId !== null ? ($report->wooById[$entry->wooId] ?? null) : null;
            $approved = $entry->settled();

            if ($entry->status === Entry::NEW || $entry->status === Entry::APPROVED_NEW) {
                $entries[] = $this->createDraft($entry->listing, $context, $entry->status === Entry::APPROVED_NEW);
                continue;
            }
            if ($woo === null) {
                // Proposed matches carry a candidate; ambiguous ones are previewed against the suggestion, if any.
                $previewId = $entry->suggestedWooId ?? ($entry->candidates[0]->wooId ?? null);
                $woo = $previewId !== null ? ($report->wooById[$previewId] ?? null) : null;
                if ($woo === null) {
                    continue;
                }
            }
            $entries[] = $this->update($entry->listing, $woo, $context, $approved);
        }
        return new Plan($entries);
    }

    private function update(Listing $listing, WooProduct $woo, PlanContext $ctx, bool $approved): PlanEntry
    {
        $bases = $ctx->bases[$listing->id] ?? [];
        $items = [];

        $items[] = $this->textItem(FieldPolicy::TITLE, $woo, $this->norm($woo->title), $this->norm($listing->title), $woo->title, $listing->title, $bases, $ctx, PlanItem::RISK_MEDIUM);
        $items[] = $this->textItem(FieldPolicy::DESCRIPTION, $woo, Text::plain($woo->description), Text::plain($listing->description), $this->excerpt(Text::plain($woo->description)), $this->excerpt(Text::plain($listing->description)), $bases, $ctx, PlanItem::RISK_MEDIUM);
        $items[] = $this->imagesItem($listing, $woo, $ctx);
        [$variationItem, $variationSummary] = $this->variationsItem($listing, $woo, $ctx);
        $items[] = $variationItem;
        $items[] = $this->priceItem($listing, $woo, $ctx, $bases);
        foreach ($this->stockItems($listing, $woo, $ctx) as $stock) {
            $items[] = $stock;
        }
        $items[] = $this->personalizationItem($listing);
        $items[] = $this->stateItem($listing, $woo);
        foreach (FieldPolicy::websiteOwned() as $field) {
            $items[] = new PlanItem($field, FieldPolicy::OWNER_WEBSITE, PlanItem::UNTOUCHED, null, null, PlanItem::RISK_LOW, 'Owned by the website: never changed by synchronization.');
        }

        $warnings = $listing->warnings;
        return new PlanEntry($listing->id, $listing->title, $woo->id, PlanEntry::UPDATE, $approved, $items, $variationSummary, $warnings);
    }

    private function createDraft(Listing $listing, PlanContext $ctx, bool $approved): PlanEntry
    {
        $price = $listing->basePrice();
        $websiteCents = $price === null ? null : $ctx->defaultPricePolicy->websitePriceCents($price->toCents());
        $items = [
            new PlanItem(FieldPolicy::TITLE, FieldPolicy::OWNER_ETSY, PlanItem::CHANGE, null, $listing->title, PlanItem::RISK_LOW, 'New draft product.'),
            new PlanItem(FieldPolicy::DESCRIPTION, FieldPolicy::OWNER_ETSY, PlanItem::CHANGE, null, $this->excerpt(Text::plain($listing->description)), PlanItem::RISK_LOW),
            new PlanItem(FieldPolicy::IMAGES, FieldPolicy::OWNER_ETSY, PlanItem::CHANGE, null, ['etsy_image_ids' => $listing->imageIds()], PlanItem::RISK_LOW),
            new PlanItem(FieldPolicy::VARIATIONS, FieldPolicy::OWNER_ETSY, PlanItem::CHANGE, null, ['variants' => count($listing->variants), 'properties' => $listing->variationProperties], PlanItem::RISK_LOW),
            new PlanItem(FieldPolicy::BASE_PRICE, FieldPolicy::OWNER_ETSY, PlanItem::CHANGE, null, ['etsy_cents' => $price?->toCents(), 'website_cents' => $websiteCents, 'policy' => $ctx->defaultPricePolicy->describe()], PlanItem::RISK_LOW),
            $this->personalizationItem($listing),
            new PlanItem(FieldPolicy::SLUG, FieldPolicy::OWNER_WEBSITE, PlanItem::UNTOUCHED, null, null, PlanItem::RISK_LOW, 'You choose the URL and categories before it is published; a new product is always created as a DRAFT.'),
        ];
        return new PlanEntry($listing->id, $listing->title, null, PlanEntry::CREATE_DRAFT, $approved, $items, [], $listing->warnings);
    }

    /**
     * @param array<string,string> $bases
     */
    private function textItem(string $field, WooProduct $woo, string $wooNorm, string $etsyNorm, string $wooShown, string $etsyShown, array $bases, PlanContext $ctx, string $risk): PlanItem
    {
        if ($ctx->overridden($woo->id, $field) !== null) {
            return new PlanItem($field, FieldPolicy::OWNER_ETSY, PlanItem::SKIPPED_OVERRIDE, $wooShown, $etsyShown, PlanItem::RISK_LOW, 'The website keeps its own value (approved override).');
        }
        $result = ConflictDetector::classify($bases[$field] ?? null, ConflictDetector::hash($etsyNorm), ConflictDetector::hash($wooNorm));
        return new PlanItem($field, FieldPolicy::OWNER_ETSY, $result['status'], $wooShown, $etsyShown, $result['status'] === PlanItem::IN_SYNC ? PlanItem::RISK_LOW : $risk, $result['note']);
    }

    private function imagesItem(Listing $listing, WooProduct $woo, PlanContext $ctx): PlanItem
    {
        if ($ctx->overridden($woo->id, FieldPolicy::IMAGES) !== null) {
            return new PlanItem(FieldPolicy::IMAGES, FieldPolicy::OWNER_ETSY, PlanItem::SKIPPED_OVERRIDE, null, null, PlanItem::RISK_LOW, 'The website keeps its own images (approved override).');
        }
        $wooIds = [];
        $unrecognized = 0;
        foreach ($woo->imageFilenames as $file) {
            $id = Text::etsyImageId($file);
            $id === null ? $unrecognized++ : $wooIds[] = $id;
        }
        $etsyIds = $listing->imageIds();
        $missing = array_values(array_diff($etsyIds, $wooIds));
        $extra = array_values(array_diff($wooIds, $etsyIds));
        $sameOrder = $unrecognized === 0 && $wooIds === $etsyIds;
        $before = ['etsy_image_ids_on_website' => $wooIds, 'other_images' => $unrecognized];
        $after = ['etsy_image_ids' => $etsyIds];
        if ($sameOrder) {
            return new PlanItem(FieldPolicy::IMAGES, FieldPolicy::OWNER_ETSY, PlanItem::IN_SYNC, $before, $after);
        }
        $notes = [];
        if ($missing !== []) {
            $notes[] = count($missing) . ' Etsy image(s) would be added';
        }
        if ($extra !== []) {
            $notes[] = count($extra) . ' website image(s) from Etsy are no longer on the listing';
        }
        if ($unrecognized > 0) {
            $notes[] = $unrecognized . ' website image(s) cannot be traced to Etsy and would be kept, never removed automatically';
        }
        if ($missing === [] && $extra === [] && $unrecognized === 0) {
            $notes[] = 'same images, different order';
        }
        return new PlanItem(FieldPolicy::IMAGES, FieldPolicy::OWNER_ETSY, PlanItem::CHANGE, $before, $after, PlanItem::RISK_MEDIUM, implode('; ', $notes) . '.');
    }

    /** @return array{0:PlanItem,1:array<string,mixed>} */
    private function variationsItem(Listing $listing, WooProduct $woo, PlanContext $ctx): array
    {
        $actions = [];
        $usedWoo = [];
        $attributeChanges = 0;
        $creates = 0;
        $matched = 0;
        $etsyVariants = array_values(array_filter($listing->variants, static fn (Variant $v): bool => !$v->deleted));
        foreach ($etsyVariants as $variant) {
            $target = $this->findVariation($variant, $woo, $usedWoo);
            if ($target === null) {
                $creates++;
                $actions[] = ['etsy_product_id' => $variant->productId, 'sku' => $variant->sku, 'options' => $variant->options, 'action' => 'create'];
                continue;
            }
            $usedWoo[$target->id] = true;
            $matched++;
            $needsAttributes = $this->attributesDiffer($variant, $target);
            $attributeChanges += $needsAttributes ? 1 : 0;
            $actions[] = ['etsy_product_id' => $variant->productId, 'woo_variation_id' => $target->id, 'sku' => $variant->sku, 'options' => $variant->options, 'action' => $needsAttributes ? 'set_attributes' : 'keep'];
        }
        $orphans = array_values(array_filter($woo->variations, static fn (WooVariation $v): bool => !isset($usedWoo[$v->id])));
        $summary = ['etsy_variants' => count($etsyVariants), 'woo_variations' => count($woo->variations), 'matched' => $matched, 'to_create' => $creates, 'attribute_changes' => $attributeChanges, 'woo_only' => count($orphans), 'actions' => $actions];

        if ($ctx->overridden($woo->id, FieldPolicy::VARIATIONS) !== null) {
            return [new PlanItem(FieldPolicy::VARIATIONS, FieldPolicy::OWNER_ETSY, PlanItem::SKIPPED_OVERRIDE, null, null, PlanItem::RISK_LOW, 'The website keeps its own variations (approved override).'), $summary];
        }
        $etsyHasVariations = $listing->variationProperties !== [] && count($etsyVariants) > 0;
        $structural = ($woo->type === 'simple' && $etsyHasVariations && count($etsyVariants) > 1) || ($woo->type === 'variable' && !$etsyHasVariations && $woo->variations !== []);
        $clean = !$structural && $creates === 0 && $attributeChanges === 0 && $orphans === [];
        $notes = [];
        if ($structural) {
            $notes[] = $woo->type === 'simple' ? 'the website product has no variations but the listing has ' . count($etsyVariants) : 'the listing has no variations but the website product does';
        }
        if ($attributeChanges > 0) {
            $notes[] = $attributeChanges . ' variation(s) would get specific option values where the website has blank ("Any") values; variation IDs are kept';
        }
        if ($creates > 0) {
            $notes[] = $creates . ' new variation(s)';
        }
        if ($orphans !== []) {
            $notes[] = count($orphans) . ' website variation(s) have no Etsy counterpart and would be flagged, not deleted';
        }
        $risk = ($structural || $attributeChanges > 0 || $creates > 0) ? PlanItem::RISK_HIGH : ($orphans !== [] ? PlanItem::RISK_MEDIUM : PlanItem::RISK_LOW);
        $item = new PlanItem(
            FieldPolicy::VARIATIONS,
            FieldPolicy::OWNER_ETSY,
            $clean ? PlanItem::IN_SYNC : PlanItem::CHANGE,
            ['woo_variations' => count($woo->variations)],
            ['etsy_variants' => count($etsyVariants), 'properties' => $listing->variationProperties],
            $clean ? PlanItem::RISK_LOW : $risk,
            $clean ? '' : implode('; ', $notes) . '.',
        );
        return [$item, $summary];
    }

    /** @param array<int,bool> $used */
    private function findVariation(Variant $variant, WooProduct $woo, array $used): ?WooVariation
    {
        $free = array_values(array_filter($woo->variations, static fn (WooVariation $v): bool => !isset($used[$v->id])));
        foreach ($free as $candidate) {
            if ($candidate->etsyProductId === $variant->productId && $variant->productId > 0) {
                return $candidate;
            }
        }
        if ($variant->sku !== '') {
            foreach ($free as $candidate) {
                if (strcasecmp($candidate->sku, $variant->sku) === 0) {
                    return $candidate;
                }
            }
        }
        if ($variant->productId > 0) {
            foreach ($free as $candidate) {
                if (in_array((string) $variant->productId, Text::longNumbers($candidate->sku), true)) {
                    return $candidate;
                }
            }
        }
        foreach ($free as $candidate) {
            $key = $this->wooOptionsKey($candidate);
            if ($key !== '' && $key === $variant->optionsKey()) {
                return $candidate;
            }
        }
        return null;
    }

    private function wooOptionsKey(WooVariation $variation): string
    {
        $pairs = [];
        foreach ($variation->attributes as $name => $value) {
            if (trim($value) === '') {
                return ''; // a blank ("Any") value cannot identify an option combination
            }
            $pairs[] = Variant::norm($name) . '=' . Variant::norm($value);
        }
        sort($pairs);
        return implode('|', $pairs);
    }

    private function attributesDiffer(Variant $variant, WooVariation $woo): bool
    {
        return $this->wooOptionsKey($woo) !== $variant->optionsKey();
    }

    /** @param array<string,string> $bases */
    private function priceItem(Listing $listing, WooProduct $woo, PlanContext $ctx, array $bases): PlanItem
    {
        $etsy = $listing->basePrice();
        if ($etsy === null) {
            return new PlanItem(FieldPolicy::BASE_PRICE, FieldPolicy::OWNER_ETSY, PlanItem::FLAG, $woo->priceCents, null, PlanItem::RISK_HIGH, 'Etsy returned no price for this listing, so no price change is proposed.');
        }
        $policy = $ctx->pricePolicyFor($woo->id);
        $etsyCents = $etsy->toCents();
        $websiteCents = $policy->websitePriceCents($etsyCents);
        $wooCents = $woo->variations !== [] ? $this->lowestVariationPrice($woo) : $woo->priceCents;
        $shown = ['etsy_cents' => $etsyCents, 'website_cents' => $websiteCents, 'policy' => $policy->describe()];
        if ($ctx->overridden($woo->id, FieldPolicy::BASE_PRICE) !== null) {
            return new PlanItem(FieldPolicy::BASE_PRICE, FieldPolicy::OWNER_ETSY, PlanItem::SKIPPED_OVERRIDE, $wooCents, $shown, PlanItem::RISK_LOW, 'The website keeps its own price (approved override).');
        }
        $result = ConflictDetector::classify($bases[FieldPolicy::BASE_PRICE] ?? null, ConflictDetector::hash((string) $websiteCents), ConflictDetector::hash((string) $wooCents));
        $note = $result['note'];
        if ($result['status'] !== PlanItem::IN_SYNC && $policy->type === PricePolicy::ETSY && $wooCents !== null) {
            $note = trim($note . sprintf(' Website $%s becomes $%s.', number_format($wooCents / 100, 2), number_format($websiteCents / 100, 2)));
        }
        return new PlanItem(FieldPolicy::BASE_PRICE, FieldPolicy::OWNER_ETSY, $result['status'], $wooCents, $shown, $result['status'] === PlanItem::IN_SYNC ? PlanItem::RISK_LOW : PlanItem::RISK_HIGH, $note);
    }

    private function lowestVariationPrice(WooProduct $woo): ?int
    {
        $lowest = null;
        foreach ($woo->variations as $variation) {
            if ($variation->priceCents !== null && ($lowest === null || $variation->priceCents < $lowest)) {
                $lowest = $variation->priceCents;
            }
        }
        return $lowest ?? $woo->priceCents;
    }

    /** @return list<PlanItem> */
    private function stockItems(Listing $listing, WooProduct $woo, PlanContext $ctx): array
    {
        $policy = $ctx->inventoryPolicies[$woo->id] ?? InventoryPolicy::defaultFor($listing, $ctx->shopInventoryDefault);
        if ($policy === InventoryPolicy::WOO_MANAGED) {
            return [new PlanItem(FieldPolicy::STOCK, FieldPolicy::OWNER_ETSY, PlanItem::UNTOUCHED, null, ['policy' => $policy], PlanItem::RISK_LOW, 'Stock is managed in WooCommerce: nothing is synchronized.')];
        }
        $outOfStock = 0;
        $managing = $woo->manageStock ? 1 : 0;
        foreach ($listing->variants as $variant) {
            $decision = InventoryPolicy::forVariant($policy, $listing, $variant);
            if ($decision !== null && $decision['status'] === 'outofstock') {
                $outOfStock++;
            }
        }
        $wouldManage = $policy === InventoryPolicy::ETSY_QUANTITY;
        $inSync = $woo->manageStock === $wouldManage;
        $note = match ($policy) {
            InventoryPolicy::MADE_TO_ORDER => 'Made to order: WooCommerce would not manage stock and the product stays in stock; Etsy\'s quantity is ignored.' . ($outOfStock > 0 ? ' ' . $outOfStock . ' variation(s) switched off on Etsy would be unavailable.' : ''),
            default => 'Etsy quantity would be mirrored into WooCommerce stock.',
        };
        return [new PlanItem(
            FieldPolicy::STOCK,
            FieldPolicy::OWNER_ETSY,
            $inSync && $outOfStock === 0 ? PlanItem::IN_SYNC : PlanItem::CHANGE,
            ['manage_stock' => (bool) $managing],
            ['policy' => $policy, 'manage_stock' => $wouldManage, 'unavailable_variations' => $outOfStock],
            $inSync ? PlanItem::RISK_LOW : PlanItem::RISK_MEDIUM,
            $note,
        )];
    }

    private function personalizationItem(Listing $listing): PlanItem
    {
        $p = $listing->personalization;
        if (!$p->enabled) {
            return new PlanItem(FieldPolicy::PERSONALIZATION, FieldPolicy::OWNER_ETSY, PlanItem::IN_SYNC, null, ['enabled' => false], PlanItem::RISK_LOW, 'Not personalizable on Etsy.');
        }
        $fields = [];
        foreach (preg_split('/\s*[\/\n;|]\s*|\s*,\s*/u', $p->instructions) ?: [] as $part) {
            $part = trim($part, " \t.:");
            if ($part !== '' && mb_strlen($part) <= 40) {
                $fields[] = $part;
            }
        }
        return new PlanItem(
            FieldPolicy::PERSONALIZATION,
            FieldPolicy::OWNER_ETSY,
            PlanItem::SUGGESTION,
            null,
            ['enabled' => true, 'required' => $p->required, 'max_chars' => $p->maxChars, 'instructions' => $p->instructions, 'suggested_fields' => $fields],
            PlanItem::RISK_LOW,
            'Etsy offers one text box. The website needs structured fields saved on each order item: these suggested fields come from the instructions text and are only a starting point for you to approve.',
        );
    }

    private function stateItem(Listing $listing, WooProduct $woo): PlanItem
    {
        if ($listing->state === 'active') {
            return new PlanItem(FieldPolicy::LISTING_STATE, FieldPolicy::OWNER_ETSY, PlanItem::IN_SYNC, $woo->status, 'active');
        }
        return new PlanItem(FieldPolicy::LISTING_STATE, FieldPolicy::OWNER_ETSY, PlanItem::FLAG, $woo->status, $listing->state, PlanItem::RISK_MEDIUM, sprintf('The Etsy listing is "%s". The website product is "%s". Nothing is unpublished automatically; you decide what an inactive listing means for the website.', $listing->state, $woo->status));
    }

    private function norm(string $text): string
    {
        return trim((string) preg_replace('/\s+/u', ' ', Text::decode($text)));
    }

    private function excerpt(string $text): string
    {
        return mb_strlen($text) > 160 ? mb_substr($text, 0, 157) . '...' : $text;
    }
}
