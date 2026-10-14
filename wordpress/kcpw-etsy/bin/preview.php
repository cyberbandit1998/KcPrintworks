<?php
declare(strict_types=1);

/**
 * Command-line import preview. READ-ONLY: it reads two files and writes reports. It never contacts WooCommerce or Etsy.
 *
 *   php bin/preview.php --etsy snapshot.json --woo products.csv|rest.json [--decisions matches.csv] [--out DIR]
 *                       [--price etsy|markup:1000|delta:200] [--inventory made_to_order|etsy_quantity|woo_managed]
 *
 * `snapshot.json` is the file the plugin's "Download Etsy snapshot" button writes. `--woo` takes a WooCommerce
 * product CSV export (Products > Export) or a REST snapshot made by scripts/discovery/fetch-wc-catalog.mjs.
 */

require dirname(__DIR__) . '/src/Support/Autoloader.php';
\KcPrintworks\Etsy\Support\Autoloader::register(dirname(__DIR__) . '/src');

use KcPrintworks\Etsy\Match\ArrayDecisionStore;
use KcPrintworks\Etsy\Match\Matcher;
use KcPrintworks\Etsy\Report\MarkdownReport;
use KcPrintworks\Etsy\Report\MatchCsv;
use KcPrintworks\Etsy\Report\Snapshot;
use KcPrintworks\Etsy\Sync\InventoryPolicy;
use KcPrintworks\Etsy\Sync\PlanContext;
use KcPrintworks\Etsy\Sync\Planner;
use KcPrintworks\Etsy\Sync\PricePolicy;
use KcPrintworks\Etsy\Woo\CsvExportReader;
use KcPrintworks\Etsy\Woo\JsonSnapshotReader;

$opts = getopt('', ['etsy:', 'woo:', 'decisions::', 'out::', 'price::', 'inventory::']);
if (!isset($opts['etsy'], $opts['woo'])) {
    fwrite(STDERR, "Usage: php bin/preview.php --etsy snapshot.json --woo products.csv|rest.json [--decisions matches.csv] [--out DIR]\n");
    exit(2);
}

$listings = Snapshot::listings(Snapshot::fromFile($opts['etsy']));
$reader = str_ends_with(strtolower($opts['woo']), '.json') ? JsonSnapshotReader::fromFile($opts['woo']) : CsvExportReader::fromFile($opts['woo']);
$products = $reader->products();

$decisions = [];
if (isset($opts['decisions']) && is_file($opts['decisions'])) {
    $store = new ArrayDecisionStore();
    foreach (MatchCsv::parseDecisions((string) file_get_contents($opts['decisions']), 'command line', gmdate('c')) as $d) {
        $store->save($d);
    }
    $decisions = $store->all();
}

$pricePolicy = new PricePolicy();
if (isset($opts['price']) && preg_match('/^(markup|delta):(-?\d+)$/', $opts['price'], $m) === 1) {
    $pricePolicy = new PricePolicy($m[1] === 'markup' ? PricePolicy::MARKUP_PERCENT : PricePolicy::FIXED_DELTA, (int) $m[2]);
}
$context = new PlanContext($pricePolicy, [], InventoryPolicy::assertValid($opts['inventory'] ?? InventoryPolicy::MADE_TO_ORDER));

$report = (new Matcher())->match($listings, $products, [], $decisions);
$plan = (new Planner())->plan($report, $context);
$markdown = MarkdownReport::render($report, $plan, sprintf('%d Etsy listings (%s) against %d WooCommerce products (%s)', count($listings), basename($opts['etsy']), count($products), basename($opts['woo'])));

$out = $opts['out'] ?? null;
if ($out !== null) {
    if (!is_dir($out) && !mkdir($out, 0775, true) && !is_dir($out)) {
        fwrite(STDERR, "Cannot create $out\n");
        exit(1);
    }
    file_put_contents($out . '/matches.csv', MatchCsv::render($report));
    file_put_contents($out . '/plan.json', json_encode($plan->toArray(), JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
    file_put_contents($out . '/report.md', $markdown);
    fwrite(STDERR, "Wrote matches.csv, plan.json, and report.md to $out. Nothing was changed anywhere.\n");
}
echo $markdown;
