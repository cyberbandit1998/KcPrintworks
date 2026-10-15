<?php
declare(strict_types=1);

/**
 * Writes the JSON the browser tests feed the plugin's script: the REAL output of Frontend::buildConfig() for a WooCommerce block
 * checkout, a classic checkout and a plain form. Run `php wordpress/kcpw-address-autocomplete/tests/fixture/build.php` after changing
 * the plugin's settings or config shape; FixtureTest fails when the committed files are stale. Because the PHP produces this JSON, the
 * browser tests cannot drift away from what a real page would receive.
 */

namespace KcPrintworks\AddressAutocomplete\Tests;

use KcPrintworks\AddressAutocomplete\Admin;
use KcPrintworks\AddressAutocomplete\AdminForms;
use KcPrintworks\AddressAutocomplete\FormConfig;
use KcPrintworks\AddressAutocomplete\Frontend;
use KcPrintworks\AddressAutocomplete\Picker;
use KcPrintworks\AddressAutocomplete\Settings;
use KcPrintworks\AddressAutocomplete\Shortcode;
use KcPrintworks\AddressAutocomplete\Store;
use KcPrintworks\AddressAutocomplete\Usage;

require_once dirname(__DIR__) . '/wp-stubs.php';
foreach (['Settings', 'Presets', 'FormConfig', 'PageMatcher', 'Usage', 'RateLimiter', 'Store', 'Html', 'Conflicts', 'Picker', 'PoBox', 'Validation', 'Http', 'WpHttp', 'GoogleServer', 'Webhook', 'IpHint', 'WooCommerce', 'Frontend', 'Shortcode', 'Rest', 'Admin', 'AdminForms', 'Wizard'] as $class) {
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

    // The administrator screens, as the real PHP prints them, wrapped in a rough stand-in for the WordPress admin page.
    $store = new Store(Settings::load(['mode' => 'preview', 'browser_key' => 'test-key-0000000000000000000000', 'modules' => ['gps' => true, 'pobox' => true]]), [$block]);
    $admin = new AdminForms($store);
    $page = static fn (string $title, string $body, string $scripts): string => '<!doctype html>' . "\n" . '<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>' . $title . '</title><link rel="stylesheet" href="baseline-admin.css"><link rel="stylesheet" href="kcpw-aa-admin.css"></head><body class="wp-admin"><main id="wpbody-content">' . $body . '</main>' . $scripts . '</body></html>' . "\n";
    $adminConfig = [
        'key' => '',
        'language' => '',
        'i18n' => Admin::adminStrings() + Picker::adminStrings(),
        'picker' => ['token' => 'test-token', 'query' => 'kcpw_aa_pick', 'pages' => [
            ['label' => 'Home page', 'url' => '/generic.html'],
            ['label' => 'Checkout (add an item to your cart first)', 'url' => '/block.html'],
            ['label' => 'Booking form', 'url' => '/tricky.html'],
            ['label' => 'Classic checkout', 'url' => '/classic.html'],
        ]],
    ];
    $scripts = '<script>window.KCPW_AA_MANUAL=true;</script><script src="kcpw-aa.js"></script><script>window.KCPW_AA_ADMIN=' . json_encode($adminConfig, JSON_HEX_TAG | JSON_HEX_AMP | JSON_UNESCAPED_SLASHES) . ';</script><script src="kcpw-aa-admin.js"></script>';

    $pickerStrings = json_encode(['strings' => Picker::pickerStrings()], JSON_HEX_TAG | JSON_HEX_AMP | JSON_UNESCAPED_SLASHES);
    $loader = "// Stand-in for what the plugin's PHP does: on a page opened with ?kcpw_aa_pick=<token> the picking script is added.\n"
        . "(function () {\n  if (location.search.indexOf('kcpw_aa_pick=') === -1) return;\n  window.KCPW_AA_PICKER = $pickerStrings;\n"
        . "  var link = document.createElement('link'); link.rel = 'stylesheet'; link.href = '/kcpw-aa-picker.css'; document.head.appendChild(link);\n"
        . "  var script = document.createElement('script'); script.src = '/kcpw-aa-picker.js'; document.head.appendChild(script);\n})();\n";

    // [kcpw_address_autocomplete] twice on one page: the PHP prints the fields and the configuration, exactly as WordPress would.
    \WpStub::reset();
    $shortcodeFrontend = new Frontend('/x/kcpw-address-autocomplete/kcpw-address-autocomplete.php', 'test', Settings::load(['mode' => 'live', 'browser_key' => 'test-key-0000000000000000000000', 'countries' => ['US', 'CA']]), []);
    $shortcodes = new Shortcode($shortcodeFrontend);
    $first = $shortcodes->render(['label' => 'Home address', 'name' => 'home', 'fields' => 'hidden']);
    $second = $shortcodes->render(['label' => 'Work address', 'name' => 'work', 'fields' => 'visible', 'required' => 'yes']);
    \WpStub::run('wp_footer');
    preg_match('/^window\.KCPW_AA=(.*);$/s', \WpStub::$inline['kcpw-aa:before'] ?? '', $m);
    $shortcodeConfig = json_decode($m[1] ?? '{}', true);
    $shortcodePage = '<!doctype html>' . "\n" . '<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Shortcode (stand-in page for the plugin\'s browser tests)</title><link rel="stylesheet" href="baseline.css"><link rel="stylesheet" href="kcpw-aa.css"></head><body><main><h1>Order form</h1><form id="order" action="#" novalidate>' . $first . $second . '<p><button type="submit" id="send">Send</button></p></form><pre id="posted" hidden></pre></main><script>document.getElementById(\'order\').addEventListener(\'submit\', function (e) { e.preventDefault(); var d = new FormData(e.target), o = {}; d.forEach(function (v, k) { o[k] = v; }); var p = document.getElementById(\'posted\'); p.textContent = JSON.stringify(o); p.hidden = false; });</script><script src="kcpw-aa.js" defer></script></body></html>' . "\n";

    // Every optional feature switched on, a server key saved and the two opt-ins that add a page request (location hint, checkout count),
    // with the plugin's REAL file path so the module script addresses are the ones a site would print.
    \WpStub::reset();
    \WpStub::$isCheckout = true;
    $everything = [
        'browser_key' => 'test-key-0000000000000000000000',
        'server_key' => 'test-server-key-000000000000000000',
        'countries' => ['US', 'CA'],
        'modules' => ['map_picker' => true, 'gps' => true, 'validation' => true, 'pobox' => true],
        'optins' => ['ip' => ['enabled' => true, 'source' => 'header'], 'abandonment' => ['enabled' => true]],
    ];
    $real = dirname(__DIR__, 2) . '/kcpw-address-autocomplete.php';
    $withModules = static fn (array $forms, string $mode): array => (new Frontend($real, 'test', Settings::load(['mode' => $mode] + $everything), $forms))->buildConfig($forms, $mode === 'preview');
    \WpStub::$canManage = true;
    $modulesBlock = $withModules([$block], 'live');
    $modulesPlain = $withModules([$plain], 'live');
    $modulesPreview = $withModules([$block], 'preview');
    \WpStub::$canManage = false;
    \WpStub::$isCheckout = false;

    // Every administrator screen, as the real PHP prints it, for the accessibility scans and for looking at.
    \WpStub::reset();
    \WpStub::$options[Usage::OPTION] = Usage::bump(Usage::record(null, ['r' => 18, 'd' => 5, 's' => 5, 'm' => 1, 'e' => ['quota' => 1]], gmdate('Y-m-d')), ['v' => 4, 'cs' => 9, 'cc' => 6], gmdate('Y-m-d'));
    \WpStub::$transients['kcpw_aa_conflicts'] = [['handle' => 'some-map-plugin', 'host' => 'maps.googleapis.com']];
    $screens = new Admin('/x/kcpw-address-autocomplete/kcpw-address-autocomplete.php', 'test', new Store(Settings::load(['mode' => 'preview', 'browser_key' => 'test-key-0000000000000000000000', 'countries' => ['US', 'CA']]), [$block]));
    // The same screens with the optional features and the opt-ins switched on, so their controls and statuses are scanned too.
    $featuresScreens = new Admin('/x/kcpw-address-autocomplete/kcpw-address-autocomplete.php', 'test', new Store(Settings::load([
        'mode' => 'preview', 'browser_key' => 'test-key-0000000000000000000000', 'server_key' => 'test-server-key-000000000000000000',
        'modules' => ['pobox' => true, 'validation' => true, 'gps' => true, 'map_picker' => true],
        'optins' => ['webhook' => ['enabled' => true, 'consent' => true, 'url' => 'https://hooks.example.test/in', 'events' => ['bad', 'pobox']], 'abandonment' => ['enabled' => true], 'ip' => ['enabled' => true, 'source' => 'service', 'service_url' => 'https://lookup.example.test/json/{ip}']],
    ]), [$block]));
    $wizard = new \KcPrintworks\AddressAutocomplete\Wizard(new Store(Settings::load([]), []));
    $keyConfig = $adminConfig;
    $keyConfig['key'] = 'test-key-0000000000000000000000';
    $keyScripts = '<script>window.KCPW_AA_MANUAL=true;</script><script src="kcpw-aa.js"></script><script>window.KCPW_AA_ADMIN=' . json_encode($keyConfig, JSON_HEX_TAG | JSON_HEX_AMP | JSON_UNESCAPED_SLASHES) . ';</script><script src="kcpw-aa-admin.js"></script>';

    return [
        'config-modules-block.json' => $encode($modulesBlock),
        'config-modules-plain.json' => $encode($modulesPlain),
        'config-modules-preview.json' => $encode($modulesPreview),
        'config-shortcode.json' => $encode($shortcodeConfig ?? []),
        'shortcode.html' => $shortcodePage,
        'admin-dashboard.html' => $page('Address Autocomplete (stand-in for the WordPress admin page)', $screens->dashboardHtml(), $keyScripts),
        'admin-settings-general.html' => $page('Settings (stand-in for the WordPress admin page)', $screens->settingsHtml('general'), $scripts),
        'admin-settings-behavior.html' => $page('Settings: behavior (stand-in for the WordPress admin page)', $screens->settingsHtml('behavior'), $scripts),
        'admin-settings-modules.html' => $page('Settings: features (stand-in for the WordPress admin page)', $featuresScreens->settingsHtml('modules'), $scripts),
        'admin-settings-optins.html' => $page('Settings: privacy and opt-ins (stand-in for the WordPress admin page)', $featuresScreens->settingsHtml('optins'), $scripts),
        'admin-dashboard-features.html' => $page('Address Autocomplete with features on (stand-in for the WordPress admin page)', $featuresScreens->dashboardHtml(), $keyScripts),
        'admin-settings-style.html' => $page('Settings: appearance (stand-in for the WordPress admin page)', $screens->settingsHtml('style'), $scripts),
        'admin-wizard-1.html' => $page('Set up, step 1 (stand-in for the WordPress admin page)', $wizard->html(1), $scripts),
        'admin-wizard-2.html' => $page('Set up, step 2 (stand-in for the WordPress admin page)', $wizard->html(2), $scripts),
        'admin-wizard-3.html' => $page('Set up, step 3 (stand-in for the WordPress admin page)', $wizard->html(3), $scripts),
        'config-block.json' => $encode($frontend([$block])->buildConfig([$block], false)),
        'config-classic.json' => $encode($frontend([$classic])->buildConfig([$classic], false)),
        'config-plain.json' => $encode($frontend([$plain])->buildConfig([$plain], false)),
        'config-preview.json' => $encode($frontend([$block], true)->buildConfig([$block], true)),
        'admin-editor.html' => $page('Add a form (stand-in for the WordPress admin page)', $admin->editorHtml(FormConfig::blank('custom'), true), $scripts),
        'admin-forms.html' => $page('Address forms (stand-in for the WordPress admin page)', $admin->listHtml(), $scripts),
        'picker-loader.js' => $loader,
    ];
}

if (PHP_SAPI === 'cli' && realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__) {
    foreach (kcpw_aa_fixture_files() as $name => $json) {
        file_put_contents(__DIR__ . '/' . $name, $json);
        echo "Wrote $name\n";
    }
}
