<?php
declare(strict_types=1);

namespace KcPrintworks\Quotes\Service;

/**
 * "Is everything ready?" for the owner: plain checks, each with what to do about it. Reads settings; changes nothing. The facts come from
 * Wp\HealthProbe; the wording and the pass/warn/fail decisions live here so they can be tested.
 */
final class Health
{
    /**
     * @param array{wooActive:bool,secretLength:int,storefrontSet:bool,tablesExist:bool,permalinks:bool,https:bool,decimals:int,currency:string,uploadsWritable:bool,uploadsInsideWeb:bool,uploadsReachable:?bool,redraws:bool,postMaxBytes:int,cronScheduled:bool,stripeActive:bool,stripeTestMode:?bool,taxable:bool,notifyEmail:string} $s
     * @return list<array{label:string,status:string,detail:string}> status is "pass", "warn" or "fail"
     */
    public static function checks(array $s): array
    {
        $out = [];
        $add = static function (string $label, string $status, string $detail = '') use (&$out): void {
            $out[] = ['label' => $label, 'status' => $status, 'detail' => $detail];
        };
        $add('WooCommerce is active', $s['wooActive'] ? 'pass' : 'fail', $s['wooActive'] ? '' : 'Activate WooCommerce.');
        $add('Quote tables exist', $s['tablesExist'] ? 'pass' : 'fail', $s['tablesExist'] ? '' : 'Deactivate and activate the plugin to create them.');
        $add(
            'Shared secret is set (KCPW_HANDOFF_SECRET)',
            $s['secretLength'] >= 32 ? 'pass' : 'fail',
            $s['secretLength'] >= 32 ? '' : 'Add define(\'KCPW_HANDOFF_SECRET\', \'<32 or more random characters>\'); to wp-config.php. It is the same value the storefront uses (checkout already needs it).',
        );
        $add(
            'Storefront address is set (KCPW_STOREFRONT_URL)',
            $s['storefrontSet'] ? 'pass' : 'fail',
            $s['storefrontSet'] ? '' : 'Add define(\'KCPW_STOREFRONT_URL\', \'https://kcprintworks.com\'); to wp-config.php. Without it a quote cannot be emailed, because its private link starts with this address.',
        );
        $add('Pretty permalinks are on', $s['permalinks'] ? 'pass' : 'fail', $s['permalinks'] ? '' : 'Settings > Permalinks: choose anything other than "Plain" so /wp-json/ works.');
        $add('This site uses https', $s['https'] ? 'pass' : 'warn', $s['https'] ? '' : 'Payments need https. Fix the site address in Settings > General.');
        $add(
            'Store currency works with quotes (' . $s['currency'] . ')',
            $s['decimals'] === 2 ? 'pass' : 'fail',
            $s['decimals'] === 2 ? '' : 'Quotes need a currency with two decimal places; your store uses ' . $s['decimals'] . '.',
        );
        $add(
            'Pictures folder can be written to',
            $s['uploadsWritable'] ? 'pass' : 'fail',
            $s['uploadsWritable'] ? '' : 'The folder for customers\' pictures cannot be created or written. Set KCPW_QUOTES_UPLOAD_DIR in wp-config.php to a folder the web server can write.',
        );
        if ($s['uploadsReachable'] === true) {
            $add('Pictures folder is not public', 'fail', 'A test file in the pictures folder could be opened from the internet. Add a rule to your web server to deny that folder, or set KCPW_QUOTES_UPLOAD_DIR to a folder outside the web root.');
        } elseif ($s['uploadsInsideWeb']) {
            $add(
                'Pictures folder is not public',
                'warn',
                $s['uploadsReachable'] === false
                    ? 'A web test could not open a test file there, which is good. It sits inside the uploads folder, so on Nginx (which ignores .htaccess) confirm it stays that way, or move it outside the web root with KCPW_QUOTES_UPLOAD_DIR.'
                    : 'It sits inside the uploads folder and the web test could not run. Files there have random 40-character names, but moving them outside the web root with KCPW_QUOTES_UPLOAD_DIR is better.',
            );
        } else {
            $add('Pictures folder is outside the web root', 'pass');
        }
        $add(
            'Pictures are cleaned (GD image library)',
            $s['redraws'] ? 'pass' : 'warn',
            $s['redraws'] ? '' : 'The GD PHP extension is missing, so pictures are kept exactly as sent (after type and size checks). Ask your host to enable GD.',
        );
        $add(
            'Uploads can be big enough (post_max_size)',
            $s['postMaxBytes'] === 0 || $s['postMaxBytes'] >= 8 * 1024 * 1024 ? 'pass' : 'warn',
            $s['postMaxBytes'] === 0 || $s['postMaxBytes'] >= 8 * 1024 * 1024 ? '' : 'PHP accepts requests of only ' . round($s['postMaxBytes'] / 1048576, 1) . ' MB; requests with four large pictures need about 8 MB. Raise post_max_size.',
        );
        $add('Expiry job is scheduled', $s['cronScheduled'] ? 'pass' : 'warn', $s['cronScheduled'] ? '' : 'The hourly job that ends old quotes is not scheduled. Deactivate and activate the plugin.');
        $add('Notifications go to ' . $s['notifyEmail'], 'pass', 'Use "Send a test email" below to check that your site can send mail.');
        $add(
            $s['taxable'] ? 'Sales tax is added by WooCommerce on top of quotes' : 'Quoted totals are final (no tax is added)',
            'pass',
            $s['taxable'] ? 'KCPW_QUOTES_TAXABLE is on. Customers are told tax is added at payment. Check a test order on staging.' : 'If you must charge sales tax, include it in the quote or set KCPW_QUOTES_TAXABLE to true in wp-config.php.',
        );
        if (!$s['stripeActive']) {
            $add('Official Stripe plugin is active', 'warn', 'Install and activate "WooCommerce Stripe Payment Gateway" before taking payments.');
        } elseif ($s['stripeTestMode'] === true) {
            $add('Stripe is in TEST mode', 'pass', 'Correct for staging: use Stripe test cards only.');
        } elseif ($s['stripeTestMode'] === false) {
            $add('Stripe is in LIVE mode', 'warn', 'Real cards would be charged for approved quotes.');
        } else {
            $add('Stripe mode', 'warn', 'Could not read the Stripe plugin\'s mode. Check its settings screen.');
        }
        return $out;
    }
}
