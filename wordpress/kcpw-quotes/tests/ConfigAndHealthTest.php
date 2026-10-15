<?php
declare(strict_types=1);

namespace KcPrintworks\Quotes\Tests;

use KcPrintworks\Quotes\Service\Health;
use KcPrintworks\Quotes\Wp\Config;
use KcPrintworks\Quotes\Wp\HealthProbe;

final class ConfigAndHealthTest extends TestCase
{
    public function testStorefrontAddressesMustBeHttpsOrLocal(): void
    {
        $this->assertTrue(Config::validStorefrontUrl('https://kcprintworks.com'));
        $this->assertTrue(Config::validStorefrontUrl('http://localhost:3000'));
        $this->assertTrue(Config::validStorefrontUrl('http://127.0.0.1:3100'));
        foreach (['http://kcprintworks.com', 'ftp://kcprintworks.com', 'kcprintworks.com', '//kcprintworks.com', 'https://user:pw@kcprintworks.com', 'javascript:alert(1)', ''] as $bad) {
            $this->assertFalse(Config::validStorefrontUrl($bad), $bad);
        }
    }

    public function testDefaultsAreSafeAndTheSecretComesFromTheConstant(): void
    {
        \WpStub::reset();
        $settings = Config::settings();
        $this->assertSame(\KCPW_HANDOFF_SECRET, $settings->secret);
        $this->assertSame('https://storefront.example.com', $settings->storefrontUrl, 'no trailing slash');
        $this->assertSame('contact@kcprintworks.com', $settings->notifyEmail);
        $this->assertFalse($settings->taxable, 'no tax unless asked for');
        $this->assertSame(14, $settings->validDays);
        $this->assertSame(72 * 3600, $settings->payWindowSeconds);
        $this->assertSame(6, $settings->maxPerClientPerHour);
        $this->assertSame(100, $settings->maxAllPerHour);
        $this->assertSame('America/Detroit', $settings->timezone);
        $this->assertSame('https://storefront.example.com/custom-orders/quote/?ref=KCQ-2610-ABCDEF&token=abc_-', $settings->quoteLink('KCQ-2610-ABCDEF', 'abc_-'));
    }

    public function testThePicturesFolderDefaultsToAProtectedFolderInsideUploads(): void
    {
        \WpStub::reset();
        $where = Config::uploadDir();
        $this->assertSame(\WpStub::$uploads . '/kcpw-quotes-private', $where['dir']);
        $this->assertTrue($where['insideUploads']);
    }

    public function testSizesInPhpIniNotationBecomeBytes(): void
    {
        $this->assertSame(8 * 1024 * 1024, HealthProbe::bytes('8M'));
        $this->assertSame(2 * 1024 ** 3, HealthProbe::bytes('2G'));
        $this->assertSame(512 * 1024, HealthProbe::bytes('512K'));
        $this->assertSame(1000, HealthProbe::bytes('1000'));
        $this->assertSame(0, HealthProbe::bytes('-1'));
        $this->assertSame(0, HealthProbe::bytes(''));
    }

    /** @return array<string,mixed> */
    private function facts(array $over = []): array
    {
        return $over + [
            'wooActive' => true, 'secretLength' => 52, 'storefrontSet' => true, 'tablesExist' => true, 'permalinks' => true, 'https' => true, 'decimals' => 2,
            'currency' => 'USD', 'uploadsWritable' => true, 'uploadsInsideWeb' => false, 'uploadsReachable' => null, 'redraws' => true, 'postMaxBytes' => 16 * 1048576,
            'cronScheduled' => true, 'stripeActive' => true, 'stripeTestMode' => true, 'taxable' => false, 'notifyEmail' => 'contact@kcprintworks.com',
        ];
    }

    /** @return array<string,string> label => status */
    private function statuses(array $facts): array
    {
        $out = [];
        foreach (Health::checks($facts) as $check) {
            $out[$check['label']] = $check['status'];
        }
        return $out;
    }

    public function testAHealthySetupHasNoFailuresAndNoWarningsBeyondTheInformationalOnes(): void
    {
        $checks = Health::checks($this->facts());
        $this->assertSame([], array_values(array_filter($checks, static fn (array $c): bool => $c['status'] === 'fail')));
        $this->assertSame([], array_values(array_filter($checks, static fn (array $c): bool => $c['status'] === 'warn')));
    }

    public function testEachProblemIsNamedWithWhatToDoAboutIt(): void
    {
        $cases = [
            'WooCommerce is active' => ['wooActive' => false],
            'Quote tables exist' => ['tablesExist' => false],
            'Shared secret is set (KCPW_HANDOFF_SECRET)' => ['secretLength' => 10],
            'Storefront address is set (KCPW_STOREFRONT_URL)' => ['storefrontSet' => false],
            'Pretty permalinks are on' => ['permalinks' => false],
            'Store currency works with quotes (USD)' => ['decimals' => 0],
            'Pictures folder can be written to' => ['uploadsWritable' => false],
            'Pictures folder is not public' => ['uploadsInsideWeb' => true, 'uploadsReachable' => true],
        ];
        foreach ($cases as $label => $facts) {
            $checks = Health::checks($this->facts($facts));
            $hit = array_values(array_filter($checks, static fn (array $c): bool => $c['label'] === $label));
            $this->assertCount(1, $hit, $label);
            $this->assertSame('fail', $hit[0]['status'], $label);
            $this->assertTrue($hit[0]['detail'] !== '', "$label says what to do");
        }
        $this->assertSame('warn', $this->statuses($this->facts(['https' => false]))['This site uses https']);
        $this->assertSame('warn', $this->statuses($this->facts(['redraws' => false]))['Pictures are cleaned (GD image library)']);
        $this->assertSame('warn', $this->statuses($this->facts(['postMaxBytes' => 2 * 1048576]))['Uploads can be big enough (post_max_size)']);
        $this->assertSame('warn', $this->statuses($this->facts(['cronScheduled' => false]))['Expiry job is scheduled']);
        $this->assertSame('warn', $this->statuses($this->facts(['uploadsInsideWeb' => true]))['Pictures folder is not public']);
        $this->assertSame('warn', $this->statuses($this->facts(['stripeTestMode' => false]))['Stripe is in LIVE mode']);
        $this->assertSame('pass', $this->statuses($this->facts(['stripeTestMode' => true]))['Stripe is in TEST mode']);
        $this->assertSame('warn', $this->statuses($this->facts(['stripeActive' => false]))['Official Stripe plugin is active']);
    }

    public function testTheWebProbeOnlyReportsReachableWhenThePictureReallyCameBack(): void
    {
        $g = GlueFixtures::boot();
        \WpStub::$httpOpensProbe = false;
        $this->assertSame(false, HealthProbe::facts(true)['uploadsReachable']);
        \WpStub::$httpOpensProbe = true;
        $this->assertSame(true, HealthProbe::facts(true)['uploadsReachable']);
        $this->assertSame([], array_values(array_filter(glob(\WpStub::$uploads . '/kcpw-quotes-private/*') ?: [], static fn (string $f): bool => preg_match('/[0-9a-f]{40}$/', $f) === 1)), 'the probe file is removed');
        $g->cleanup();
    }
}
