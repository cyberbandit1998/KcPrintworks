<?php
declare(strict_types=1);

/**
 * Writes checkout.html from checkout.template.html: the plugin's REAL header and theme-chrome rule are rendered by the plugin's own
 * code and placed into the stand-in page, so the fixture can never drift from the plugin (a PHP test regenerates it and compares).
 * Usage: php wordpress/kcpw-checkout-style/tests/fixture/build.php
 */

use KcPrintworks\CheckoutStyle\HeaderMarkup;
use KcPrintworks\CheckoutStyle\Plugin;
use KcPrintworks\CheckoutStyle\Settings;

require_once dirname(__DIR__, 2) . '/src/Settings.php';
require_once dirname(__DIR__, 2) . '/src/HeaderMarkup.php';
require_once dirname(__DIR__, 2) . '/src/Plugin.php';

function kcpw_fixture_html(): string
{
    $chrome = '<style id="kcpw-checkout-chrome">' . Settings::hideCss(Plugin::THEME_CHROME) . '</style>'
        . HeaderMarkup::render(HeaderMarkup::VARIANT_CHECKOUT, 'https://kcprintworks.com/', 'https://kcprintworks.com/cart/');
    return str_replace('{{CHROME_AND_HEADER}}', $chrome, (string) file_get_contents(__DIR__ . '/checkout.template.html'));
}

if (PHP_SAPI === 'cli' && realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__) {
    file_put_contents(__DIR__ . '/checkout.html', kcpw_fixture_html());
    echo "Wrote checkout.html\n";
}
