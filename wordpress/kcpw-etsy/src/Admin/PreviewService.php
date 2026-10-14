<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Admin;

use KcPrintworks\Etsy\Match\DecisionStore;
use KcPrintworks\Etsy\Match\Matcher;
use KcPrintworks\Etsy\Report\Snapshot;
use KcPrintworks\Etsy\Snapshot\SnapshotStore;
use KcPrintworks\Etsy\Sync\InventoryPolicy;
use KcPrintworks\Etsy\Sync\PlanContext;
use KcPrintworks\Etsy\Sync\Planner;
use KcPrintworks\Etsy\Sync\PricePolicy;
use KcPrintworks\Etsy\Woo\WooReader;

/** Builds the match report and dry-run plan from stored data. Reads only. */
final class PreviewService
{
    private ?PreviewResult $cached = null;

    /** @param (callable():string)|null $now */
    public function __construct(
        private readonly SnapshotStore $snapshots,
        private readonly WooReader $woo,
        private readonly DecisionStore $decisions,
        private readonly MappingStore $mappings,
        private readonly SettingsStore $settings,
        private $now = null,
    ) {
        $this->now = $now ?? static fn (): string => gmdate('c');
    }

    public function build(): PreviewResult
    {
        if ($this->cached !== null) {
            return $this->cached;
        }
        $listings = Snapshot::listings($this->snapshots->all());
        $products = $this->woo->products();
        $report = (new Matcher())->match($listings, $products, $this->mappings->all(), $this->decisions->all());
        $plan = (new Planner())->plan($report, $this->context());
        return $this->cached = new PreviewResult($listings, $products, $report, $plan, ($this->now)());
    }

    private function context(): PlanContext
    {
        $type = (string) $this->settings->get('price_policy_type', PricePolicy::ETSY);
        $value = (int) $this->settings->get('price_policy_value', 0);
        $inventory = (string) $this->settings->get('inventory_default', InventoryPolicy::MADE_TO_ORDER);
        try {
            $price = new PricePolicy($type, $value);
            $inventory = InventoryPolicy::assertValid($inventory);
        } catch (\InvalidArgumentException) {
            $price = new PricePolicy();
            $inventory = InventoryPolicy::MADE_TO_ORDER;
        }
        return new PlanContext($price, [], $inventory);
    }
}
