<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Snapshot;

use KcPrintworks\Etsy\Api\AccessDenied;
use KcPrintworks\Etsy\Api\ApiError;
use KcPrintworks\Etsy\Api\EtsyClient;
use KcPrintworks\Etsy\Oauth\NeedsReauth;

/**
 * Downloads the shop's listings, inventory, and images into the snapshot store: READ-ONLY calls to Etsy, in small
 * time-boxed batches so no request runs long. It never touches WooCommerce.
 *
 *  start()  lists every listing in the chosen states and records them (cheap: 100 per call).
 *  batch()  fetches inventory and images for the listings that still need them, up to a limit per call, and is
 *           called again until nothing is pending. A listing that has not changed on Etsy keeps its stored details.
 *  Stops early (state "paused") when the daily API budget reaches its reserve (Quota::backgroundBudgetExhausted).
 */
final class Collector
{
    public const DEFAULT_STATES = ['active', 'inactive', 'sold_out', 'draft', 'expired'];

    /** @param (callable():string)|null $now */
    public function __construct(
        private readonly EtsyClient $client,
        private readonly SnapshotStore $store,
        private readonly RunStateStore $states,
        private $now = null,
    ) {
        $this->now = $now ?? static fn (): string => gmdate('c');
    }

    /** @param list<string> $states */
    public function start(int $shopId, array $states = self::DEFAULT_STATES, string $trigger = 'manual'): RunState
    {
        $state = new RunState(RunState::LISTING, ($this->now)(), '', 0, 0, 0, [], [], $trigger);
        $this->states->save($state);
        $seen = [];
        try {
            foreach ($this->client->iterateListings($shopId, $states) as $listing) {
                $id = (int) ($listing['listing_id'] ?? 0);
                if ($id > 0) {
                    $this->store->saveListing($id, $listing);
                    $seen[$id] = true;
                }
            }
            $this->store->retainOnly(array_keys($seen));
            $state->listings = count($seen);
            $state->phase = RunState::DETAILS;
        } catch (NeedsReauth $e) {
            return $this->fail($state, 'Etsy needs to be reconnected: ' . $e->getMessage());
        } catch (AccessDenied | ApiError $e) {
            return $this->fail($state, $e->getMessage());
        }
        $state->quota = $this->client->lastQuota()?->toArray() ?? [];
        $this->states->save($state);
        return $state;
    }

    public function batch(int $limit = 12): RunState
    {
        $state = $this->states->load();
        if ($state->phase !== RunState::DETAILS) {
            return $state;
        }
        foreach ($this->store->pendingDetailIds($limit, $state->failedIds) as $listingId) {
            if ($this->client->lastQuota()?->backgroundBudgetExhausted()) {
                $state->phase = RunState::PAUSED;
                $state->errors[] = 'Paused to keep the daily Etsy API budget in reserve. It resumes automatically.';
                $this->states->save($state);
                return $state;
            }
            try {
                $inventory = $this->client->getInventory($listingId);
                $images = $this->client->getImages($listingId);
                $this->store->saveDetails($listingId, $inventory, $images);
                $state->detailsDone++;
            } catch (NeedsReauth $e) {
                return $this->fail($state, 'Etsy needs to be reconnected: ' . $e->getMessage());
            } catch (AccessDenied | ApiError $e) {
                // One bad listing must not stop the run: record it and leave it pending for the next run.
                $state->detailsFailed++;
                $state->failedIds[] = $listingId;
                $state->errors[] = sprintf('Listing %d: %s', $listingId, $e->getMessage());
            }
        }
        $state->quota = $this->client->lastQuota()?->toArray() ?? [];
        if ($this->store->pendingDetailIds(1, $state->failedIds) === []) {
            $state->phase = RunState::DONE;
            $state->finishedAt = ($this->now)();
        }
        $state->errors = array_slice($state->errors, -20);
        $this->states->save($state);
        return $state;
    }

    private function fail(RunState $state, string $message): RunState
    {
        $state->phase = RunState::FAILED;
        $state->finishedAt = ($this->now)();
        $state->errors[] = $message;
        $this->states->save($state);
        return $state;
    }
}
