<?php
declare(strict_types=1);

namespace KcPrintworks\CheckoutStyle\Tests;

final class FixtureTest extends TestCase
{
    public function testTheRenderedFixtureIsExactlyWhatThePluginPrints(): void
    {
        // The browser tests render fixture/checkout.html; its header and theme-chrome rule are produced by the plugin's own code.
        // If either changes, run: php wordpress/kcpw-checkout-style/tests/fixture/build.php
        $this->assertSame(
            kcpw_fixture_html(),
            (string) file_get_contents(__DIR__ . '/fixture/checkout.html'),
            'fixture/checkout.html is stale',
        );
    }
}
