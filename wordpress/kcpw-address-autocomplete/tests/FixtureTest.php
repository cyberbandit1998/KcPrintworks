<?php
declare(strict_types=1);

namespace KcPrintworks\AddressAutocomplete\Tests;

require_once __DIR__ . '/fixture/build.php';

final class FixtureTest extends TestCase
{
    public function testTheCommittedBrowserTestConfigsAreWhatThePluginPrintsToday(): void
    {
        foreach (kcpw_aa_fixture_files() as $name => $json) {
            $path = __DIR__ . '/fixture/' . $name;
            $this->assertTrue(is_file($path), "$name exists (run php tests/fixture/build.php)");
            $this->assertSame($json, (string) file_get_contents($path), "$name is current (run php tests/fixture/build.php)");
        }
    }

    public function testNoFixtureHoldsARealKey(): void
    {
        foreach (glob(__DIR__ . '/fixture/config-*.json') ?: [] as $file) {
            $this->assertNotContains('AIza', (string) file_get_contents($file), basename($file));
        }
    }
}
