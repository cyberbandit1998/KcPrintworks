<?php
declare(strict_types=1);

namespace KcPrintworks\Core\Tests;

use KcPrintworks\Core\Wp\Readiness;

final class ReadinessTest extends TestCase
{
    private function state(array $override = []): array
    {
        return $override + [
            'secretLength' => 64, 'storefront' => 'https://staging.example.com', 'https' => true, 'permalinks' => true,
            'tableExists' => true, 'wooActive' => true, 'stripeActive' => true, 'stripeTestMode' => true,
            'brokenSchemas' => [], 'pendingHandoffs' => 0,
        ];
    }

    /** @return array<string,string> label => status */
    private function statuses(array $state): array
    {
        $out = [];
        foreach (Readiness::checks($state) as $c) {
            $out[$c['label']] = $c['status'];
        }
        return $out;
    }

    public function testEverythingReadyPassesAndStripeTestModeIsCalledOut(): void
    {
        $s = $this->statuses($this->state());
        $this->assertSame([], array_keys(array_filter($s, static fn (string $v): bool => $v !== 'pass')));
        $this->assertTrue(isset($s['Stripe is in TEST mode']));
    }

    public function testLiveModeIsAWarningAndAMissingSecretIsAFailure(): void
    {
        $this->assertSame('warn', $this->statuses($this->state(['stripeTestMode' => false]))['Stripe is in LIVE mode']);
        $this->assertSame('fail', $this->statuses($this->state(['secretLength' => 10]))['Handoff secret is set (KCPW_HANDOFF_SECRET)']);
        $this->assertSame('fail', $this->statuses($this->state(['https' => false]))['This site uses https']);
        $this->assertSame('warn', $this->statuses($this->state(['stripeActive' => false, 'stripeTestMode' => null]))['Official Stripe plugin is active']);
        $broken = $this->statuses($this->state(['brokenSchemas' => ['Name Tag (#5)']]));
        $this->assertSame('fail', $broken['Personalization setups are valid']);
    }

    public function testEachCheckExplainsWhatToDoOnlyWhenItIsNotPassing(): void
    {
        foreach (Readiness::checks($this->state(['secretLength' => 0, 'permalinks' => false])) as $c) {
            if ($c['status'] === 'fail') {
                $this->assertTrue($c['detail'] !== '', $c['label']);
            }
        }
    }
}
