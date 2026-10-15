<?php
declare(strict_types=1);

/**
 * Writes the JSON the browser tests feed the plugin's script: the REAL output of Frontend::buildConfig() for a WooCommerce block
 * checkout, a classic checkout and a plain form. Run `php wordpress/kcpw-address-autocomplete/tests/fixture/build.php` after changing
 * the plugin's settings or config shape; FixtureTest fails when the committed files are stale. Because the PHP produces this JSON, the
 * browser tests cannot drift away from what a real page would receive.
 */

namespace KcPrintworks\AddressAutocomplete\Tests;

use KcPrintworks\AddressAutocomplete\FormConfig;
use KcPrintworks\AddressAutocomplete\Frontend;
use KcPrintworks\AddressAutocomplete\Settings;

require_once dirname(__DIR__) . '/wp-stubs.php';
foreach (['Settings', 'Presets', 'FormConfig', 'PageMatcher', 'Usage', 'RateLimiter', 'Frontend'] as $class) {
    require_once dirname(__DIR__, 2) . '/src/' . $class . '.php';
}

/** @return array<string, string> file name => JSON text */
function kcpw_aa_fixture_files(): array
{
    $settings = Settings::load(['mode' => 'live', 'browser_key' => 'test-key-0000000000000000000000', 'countries' => ['US', 'CA']]);
    $frontend = static fn (array $forms, bool $admin = false, array $override = []): Frontend => new Frontend(
        '/x/kcpw-address-autocomplete/kcpw-address-autocomplete.php',
        'test',
        Settings::load($override + ['mode' => $admin ? 'preview' : 'live', 'browser_key' => 'test-key-0000000000000000000000', 'countries' => ['US', 'CA']]),
        $forms,
    );

    $plain = FormConfig::sanitize([
        'id' => 'f_plainform', 'name' => 'Plain form', 'preset' => 'custom', 'mode' => 'smart',
        'groups' => [['label' => 'Form', 'fields' => ['address' => '#addr', 'address2' => '#addr2', 'city' => '#city', 'state' => '#state', 'postcode' => '#zip', 'country' => '#country']]],
        'pages' => ['mode' => 'all'],
    ]);
    $block = FormConfig::sanitize(['id' => 'f_woocommerceblock'] + FormConfig::blank('woo_block'));
    $classic = FormConfig::sanitize(['id' => 'f_woocommerceclassic'] + FormConfig::blank('woo_classic'));
    \assert($plain !== null && $block !== null && $classic !== null);

    $encode = static fn (array $config): string => json_encode($config, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) . "\n";
    return [
        'config-block.json' => $encode($frontend([$block])->buildConfig([$block], false)),
        'config-classic.json' => $encode($frontend([$classic])->buildConfig([$classic], false)),
        'config-plain.json' => $encode($frontend([$plain])->buildConfig([$plain], false)),
        'config-preview.json' => $encode($frontend([$block], true)->buildConfig([$block], true)),
    ];
}

if (PHP_SAPI === 'cli' && realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__) {
    foreach (kcpw_aa_fixture_files() as $name => $json) {
        file_put_contents(__DIR__ . '/' . $name, $json);
        echo "Wrote $name\n";
    }
}
