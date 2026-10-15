<?php
declare(strict_types=1);

namespace KcPrintworks\AddressAutocomplete\Tests;

use KcPrintworks\AddressAutocomplete\RateLimiter;
use KcPrintworks\AddressAutocomplete\Usage;

final class UsageTest extends TestCase
{
    public function testABeaconIsReducedToWholeNumbersOnly(): void
    {
        $b = Usage::cleanBeacon([
            'r' => 3, 'd' => '2', 's' => 1, 'm' => 0, 'e' => ['auth' => 2, 'weird' => 9],
            'address' => '12 Main Street, Flint', 'q' => 'what they typed', 'country' => 'US', 'ip' => '1.2.3.4', 'user' => 7,
        ]);
        $this->assertSame(['r' => 3, 'd' => 2, 's' => 1, 'm' => 0, 'e' => ['auth' => 2]], $b);
        $this->assertNotContains('Main', (string) json_encode($b), 'no text of any kind survives');
    }

    public function testBeaconsHaveCapsAndNothingCountableMeansNothingStored(): void
    {
        $this->assertSame(40, Usage::cleanBeacon(['r' => 100000])['r']);
        $this->assertSame(0, Usage::cleanBeacon(['r' => -5, 's' => 1])['r']);
        $this->assertSame(null, Usage::cleanBeacon([]));
        $this->assertSame(null, Usage::cleanBeacon(['address' => 'x']));
        $this->assertSame(null, Usage::cleanBeacon('r=1'));
        $this->assertSame(null, Usage::cleanBeacon(['r' => 'a lot', 'e' => ['auth' => 'many']]));
        $this->assertSame(20, Usage::cleanBeacon(['e' => ['quota' => 99]])['e']['quota']);
    }

    public function testRecordAddsUpAndPrunesOldDays(): void
    {
        $stored = ['days' => ['2020-01-01' => ['r' => 9, 'd' => 0, 's' => 0, 'm' => 0, 'v' => 0, 'cs' => 0, 'cc' => 0, 'e' => []]]];
        $a = ['r' => 3, 'd' => 1, 's' => 1, 'm' => 0, 'e' => ['api' => 1]];
        $once = Usage::record($stored, $a, '2026-10-15');
        $twice = Usage::record($once, $a, '2026-10-15');
        $this->assertSame(6, $twice['days']['2026-10-15']['r']);
        $this->assertSame(2, $twice['days']['2026-10-15']['e']['api']);
        $this->assertFalse(isset($twice['days']['2020-01-01']), 'a day older than the keep window is dropped');
        $this->assertSame(['days' => ['2026-10-15' => ['r' => 3, 'd' => 1, 's' => 1, 'm' => 0, 'v' => 0, 'cs' => 0, 'cc' => 0, 'e' => ['api' => 1]]]], Usage::record('garbage', $a, '2026-10-15'));
    }

    public function testServerCountersAreAddedByTheServerAndNeverTakenFromABeacon(): void
    {
        $b = Usage::cleanBeacon(['r' => 1, 'v' => 50, 'cs' => 50, 'cc' => 50]);
        $this->assertSame(['r' => 1, 'd' => 0, 's' => 0, 'm' => 0, 'e' => []], $b, 'a browser cannot report checks or checkouts');
        $s = Usage::bump(null, ['v' => 1], '2026-10-15');
        $s = Usage::bump($s, ['v' => 1, 'cs' => 1, 'cc' => 99999], '2026-10-15');
        $sum = Usage::summary($s, 30, '2026-10-15');
        $this->assertSame(2, $sum['totals']['validations']);
        $this->assertSame(1, $sum['totals']['checkoutsStarted']);
        $this->assertSame(1000, $sum['totals']['checkoutsCompleted'], 'one bump is capped');
        $this->assertSame(1, count($sum['rows']));
    }

    public function testSummaryTotalsTheWindow(): void
    {
        $s = null;
        $s = Usage::record($s, ['r' => 4, 'd' => 1, 's' => 1, 'm' => 0, 'e' => ['quota' => 1]], '2026-10-15');
        $s = Usage::record($s, ['r' => 6, 'd' => 2, 's' => 2, 'm' => 1, 'e' => []], '2026-10-10');
        $sum = Usage::summary($s, 30, '2026-10-15');
        $this->assertSame(10, $sum['totals']['requests']);
        $this->assertSame(3, $sum['totals']['details']);
        $this->assertSame(1, $sum['totals']['manual']);
        $this->assertSame(['quota' => 1], $sum['errors']);
        $this->assertSame(2, count($sum['rows']));
        $short = Usage::summary($s, 3, '2026-10-15');
        $this->assertSame(4, $short['totals']['requests'], 'a 3 day window leaves out the 5-day-old row');
        $this->assertSame(0, Usage::summary(null, 30, '2026-10-15')['totals']['requests']);
    }

    public function testRateLimiterAllowsNThenBlocksThenResets(): void
    {
        $store = [];
        $get = static function (string $k) use (&$store) {
            return $store[$k] ?? false;
        };
        $set = static function (string $k, array $v, int $ttl) use (&$store): void {
            $store[$k] = $v;
        };
        for ($i = 0; $i < 3; $i++) {
            $this->assertTrue(RateLimiter::hit($get, $set, 'k', 3, 60, 1000 + $i), "hit $i");
        }
        $this->assertFalse(RateLimiter::hit($get, $set, 'k', 3, 60, 1010), 'the fourth in the window is refused');
        $this->assertTrue(RateLimiter::hit($get, $set, 'other', 3, 60, 1010), 'another key has its own count');
        $this->assertTrue(RateLimiter::hit($get, $set, 'k', 3, 60, 1061), 'a new window starts');
        $store['bad'] = 'garbage';
        $this->assertTrue(RateLimiter::hit($get, $set, 'bad', 3, 60, 1000), 'a corrupt entry is treated as empty');
    }
}
