<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Sync;

/** Settings and stored state the planner reads. Everything here is configuration or history, never a command. */
final class PlanContext
{
    /**
     * @param array<int,PricePolicy> $pricePolicies Woo product id => policy (overrides the default)
     * @param array<int,string> $inventoryPolicies Woo product id => policy
     * @param list<Override> $overrides
     * @param array<int,array<string,string>> $bases Etsy listing id => field => hash at last sync
     */
    public function __construct(
        public readonly PricePolicy $defaultPricePolicy = new PricePolicy(),
        public readonly array $pricePolicies = [],
        public readonly string $shopInventoryDefault = InventoryPolicy::MADE_TO_ORDER,
        public readonly array $inventoryPolicies = [],
        public readonly array $overrides = [],
        public readonly array $bases = [],
    ) {
        InventoryPolicy::assertValid($shopInventoryDefault);
    }

    public function pricePolicyFor(?int $wooId): PricePolicy
    {
        return ($wooId !== null ? ($this->pricePolicies[$wooId] ?? null) : null) ?? $this->defaultPricePolicy;
    }

    public function overridden(?int $wooId, string $field): ?Override
    {
        foreach ($this->overrides as $override) {
            if ($override->wooProductId === $wooId && $override->field === $field) {
                return $override;
            }
        }
        return null;
    }
}
