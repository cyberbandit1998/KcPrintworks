<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Tests;

use KcPrintworks\Etsy\Api\ApiKeyHeader;
use KcPrintworks\Etsy\Api\EtsyClient;
use KcPrintworks\Etsy\Http\Request;
use KcPrintworks\Etsy\Http\Response;
use KcPrintworks\Etsy\Oauth\NullLock;
use KcPrintworks\Etsy\Oauth\OAuthClient;
use KcPrintworks\Etsy\Oauth\OAuthConfig;
use KcPrintworks\Etsy\Oauth\Scopes;
use KcPrintworks\Etsy\Oauth\TokenSet;
use KcPrintworks\Etsy\Oauth\TokenSource;
use KcPrintworks\Etsy\Report\Snapshot;
use KcPrintworks\Etsy\Snapshot\Collector;
use KcPrintworks\Etsy\Snapshot\MemoryRunStateStore;
use KcPrintworks\Etsy\Snapshot\MemorySnapshotStore;
use KcPrintworks\Etsy\Snapshot\RunState;

final class CollectorTest extends TestCase
{
    /**
     * @param array<int,int> $failing listing id => HTTP status for its inventory call
     * @return array{0:Collector,1:MemorySnapshotStore,2:MemoryRunStateStore,3:FakeTransport}
     */
    private function build(int $listings = 25, array $failing = [], array $quotaHeaders = []): array
    {
        $transport = new FakeTransport(function (Request $r) use ($listings, $failing, $quotaHeaders): Response {
            $path = (string) parse_url($r->url, PHP_URL_PATH);
            if (preg_match('#/shops/\d+/listings$#', $path) === 1) {
                parse_str((string) parse_url($r->url, PHP_URL_QUERY), $q);
                if ($q['state'] !== 'active') {
                    return FakeTransport::json(['count' => 0, 'results' => []], 200, $quotaHeaders);
                }
                $rows = [];
                for ($i = (int) $q['offset']; $i < min((int) $q['offset'] + 100, $listings); $i++) {
                    $rows[] = Fixtures::rawListing(1000 + $i, ['updated_timestamp' => 5]);
                }
                return FakeTransport::json(['count' => $listings, 'results' => $rows], 200, $quotaHeaders);
            }
            if (preg_match('#/listings/(\d+)/inventory$#', $path, $m) === 1) {
                if (isset($failing[(int) $m[1]])) {
                    return FakeTransport::json(['error' => 'boom'], $failing[(int) $m[1]]);
                }
                return FakeTransport::json(Fixtures::rawInventory([[(int) $m[1] * 10, 'SKU-' . $m[1], ['Color' => 'Red'], 1000]]), 200, $quotaHeaders);
            }
            if (preg_match('#/listings/(\d+)/images$#', $path, $m) === 1) {
                return FakeTransport::json(Fixtures::rawImages([(int) $m[1] * 100]), 200, $quotaHeaders);
            }
            return FakeTransport::json([], 404);
        });
        $store = new MemoryTokenStore(new TokenSet('7.token', 'refresh', 4_000_000_000, ['shops_r', 'listings_r'], 1));
        $oauth = new OAuthClient(new OAuthConfig('k', 'https://x.example/cb', Scopes::PRODUCT_IMPORT), new FakeTransport());
        $client = new EtsyClient($transport, new TokenSource($store, $oauth, new NullLock()), new ApiKeyHeader('k'), EtsyClient::API_BASE, static function (int $s): void {
        }, 2);
        $snapshots = new MemorySnapshotStore();
        $states = new MemoryRunStateStore();
        return [new Collector($client, $snapshots, $states, static fn (): string => '2026-10-14T00:00:00+00:00'), $snapshots, $states, $transport];
    }

    public function testListsEverythingThenFetchesDetailsInBatchesUntilDone(): void
    {
        [$collector, $snapshots, $states, $transport] = $this->build(25);
        $state = $collector->start(55, ['active']);
        $this->assertSame(RunState::DETAILS, $state->phase);
        $this->assertSame(25, $state->listings);
        $this->assertSame(25, $snapshots->count());

        $batches = 0;
        do {
            $state = $collector->batch(10);
            $batches++;
        } while ($state->phase === RunState::DETAILS && $batches < 10);

        $this->assertSame(3, $batches, '25 listings in batches of 10');
        $this->assertSame(RunState::DONE, $state->phase);
        $this->assertSame(25, $state->detailsDone);
        $this->assertSame([], $snapshots->pendingDetailIds(100));
        foreach ($transport->requests as $request) {
            $this->assertSame('GET', $request->method);
        }
    }

    public function testTheDownloadedSnapshotFeedsTheNormalizerWithVariantsAndImages(): void
    {
        [$collector, $snapshots] = $this->build(3);
        $collector->start(55, ['active']);
        $collector->batch(10);
        $listings = Snapshot::listings($snapshots->all());
        $this->assertCount(3, $listings);
        $this->assertSame([], $listings[0]->warnings);
        $this->assertSame('SKU-1000', $listings[0]->variants[0]->sku);
        $this->assertSame([100000], $listings[0]->imageIds());
    }

    public function testOneFailingListingIsRecordedAndDoesNotStopTheRun(): void
    {
        [$collector, $snapshots] = $this->build(4, [1001 => 500]);
        $collector->start(55, ['active']);
        $state = $collector->batch(10);
        $this->assertSame(RunState::DONE, $state->phase);
        $this->assertSame(3, $state->detailsDone);
        $this->assertSame(1, $state->detailsFailed);
        $this->assertSame([1001], $state->failedIds);
        $this->assertStringContains('Listing 1001', $state->errors[0]);
        $warnings = Snapshot::listings($snapshots->all())[1]->warnings;
        $this->assertStringContains('inventory was not downloaded', implode(' ', $warnings), 'the gap is visible in the preview, not silently empty');
    }

    public function testAnUnchangedListingKeepsItsDetailsAndAChangedOneIsFetchedAgain(): void
    {
        [$collector, $snapshots, , $transport] = $this->build(2);
        $collector->start(55, ['active']);
        $collector->batch(10);
        $before = count($transport->requests);
        $collector->start(55, ['active']);   // nothing changed on Etsy
        $collector->batch(10);
        $this->assertSame($before + 1, count($transport->requests), 'only the listing call, no detail calls');

        $snapshots->saveListing(1000, Fixtures::rawListing(1000, ['updated_timestamp' => 99]));
        $this->assertSame([1000], $snapshots->pendingDetailIds(10), 'a listing edited on Etsy is fetched again');
    }

    public function testListingsRemovedFromEtsyDisappearFromTheSnapshot(): void
    {
        [$collector, $snapshots] = $this->build(3);
        $collector->start(55, ['active']);
        $this->assertSame(3, $snapshots->count());
        [$smaller] = $this->build(3);
        $snapshots->retainOnly([1000]);
        $this->assertSame(1, $snapshots->count());
    }

    public function testRevokedAccessFailsTheRunWithAReconnectMessage(): void
    {
        $transport = new FakeTransport(fn () => FakeTransport::json([], 401));
        $store = new MemoryTokenStore(new TokenSet('7.t', 'r', 4_000_000_000, ['shops_r'], 1));
        $refreshTransport = (new FakeTransport())->queue(FakeTransport::json(['error' => 'invalid_grant'], 400));
        $oauth = new OAuthClient(new OAuthConfig('k', 'https://x.example/cb', Scopes::PRODUCT_IMPORT), $refreshTransport);
        $client = new EtsyClient($transport, new TokenSource($store, $oauth, new NullLock()), new ApiKeyHeader('k'), EtsyClient::API_BASE, static function (int $s): void {
        });
        $states = new MemoryRunStateStore();
        $state = (new Collector($client, new MemorySnapshotStore(), $states))->start(55, ['active']);
        $this->assertSame(RunState::FAILED, $state->phase);
        $this->assertStringContains('reconnected', $state->errors[0]);
    }

    public function testThePausesWhenTheDailyBudgetReserveIsReached(): void
    {
        [$collector, , , ] = $this->build(5, [], ['x-limit-per-day' => '1000', 'x-remaining-today' => '150']);
        $collector->start(55, ['active']);
        $state = $collector->batch(10);
        $this->assertSame(RunState::PAUSED, $state->phase);
        $this->assertStringContains('daily Etsy API budget', $state->errors[0]);
    }
}
