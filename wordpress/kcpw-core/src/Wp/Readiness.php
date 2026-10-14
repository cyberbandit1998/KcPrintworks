<?php
declare(strict_types=1);

namespace KcPrintworks\Core\Wp;

/**
 * "Is checkout ready?" for the owner: plain checks, each with what to do about it. Reads settings; changes nothing.
 * The Stripe check only looks at whether the official plugin is active and which mode its own setting says it is in.
 */
final class Readiness
{
    /** @return array{active:bool,testMode:?bool} */
    public static function stripe(): array
    {
        $active = class_exists('WC_Stripe') || class_exists('WC_Gateway_Stripe') || (function_exists('is_plugin_active') && is_plugin_active('woocommerce-gateway-stripe/woocommerce-gateway-stripe.php'));
        $settings = get_option('woocommerce_stripe_settings', []);
        $mode = is_array($settings) && isset($settings['testmode']) ? $settings['testmode'] === 'yes' : null;
        return ['active' => $active, 'testMode' => $active ? $mode : null];
    }

    /**
     * @param array{secretLength:int,storefront:string,https:bool,permalinks:bool,tableExists:bool,wooActive:bool,stripeActive:bool,stripeTestMode:?bool,brokenSchemas:list<string>,pendingHandoffs:int} $s
     * @return list<array{label:string,status:string,detail:string}> status is "pass", "warn" or "fail"
     */
    public static function checks(array $s): array
    {
        $out = [];
        $add = static function (string $label, string $status, string $detail) use (&$out): void {
            $out[] = ['label' => $label, 'status' => $status, 'detail' => $detail];
        };
        $add('WooCommerce is active', $s['wooActive'] ? 'pass' : 'fail', $s['wooActive'] ? '' : 'Activate WooCommerce.');
        $add('This site uses https', $s['https'] ? 'pass' : 'fail', $s['https'] ? '' : 'Checkout and payments need https. Fix the site address in Settings > General.');
        $add(
            'Handoff secret is set (KCPW_HANDOFF_SECRET)',
            $s['secretLength'] >= 32 ? 'pass' : 'fail',
            $s['secretLength'] >= 32 ? '' : 'Add define(\'KCPW_HANDOFF_SECRET\', \'<32 or more random characters>\'); to wp-config.php and put the same value in the storefront\'s environment.',
        );
        $add(
            'Storefront address is set (KCPW_STOREFRONT_URL)',
            $s['storefront'] !== '' ? 'pass' : 'warn',
            $s['storefront'] !== '' ? $s['storefront'] : 'Add define(\'KCPW_STOREFRONT_URL\', \'https://your-storefront\'); so shoppers can be sent back to the cart if something changed.',
        );
        $add('Pretty permalinks are on', $s['permalinks'] ? 'pass' : 'fail', $s['permalinks'] ? '' : 'Settings > Permalinks: choose anything other than "Plain" so /wp-json/ works.');
        $add('Handoff table exists', $s['tableExists'] ? 'pass' : 'fail', $s['tableExists'] ? 'Pending handoffs: ' . $s['pendingHandoffs'] : 'Deactivate and activate the plugin to create it.');
        $add('Official Stripe plugin is active', $s['stripeActive'] ? 'pass' : 'warn', $s['stripeActive'] ? '' : 'Install and activate "WooCommerce Stripe Payment Gateway" (by WooCommerce / Stripe) before taking payments.');
        if ($s['stripeActive']) {
            if ($s['stripeTestMode'] === true) {
                $add('Stripe is in TEST mode', 'pass', 'Correct for staging: use Stripe test cards only.');
            } elseif ($s['stripeTestMode'] === false) {
                $add('Stripe is in LIVE mode', 'warn', 'Real cards would be charged. Switch the Stripe plugin to test mode until you have approved going live.');
            } else {
                $add('Stripe mode', 'warn', 'Could not read the Stripe plugin\'s mode. Check its settings screen.');
            }
        }
        $add(
            'Personalization setups are valid',
            $s['brokenSchemas'] === [] ? 'pass' : 'fail',
            $s['brokenSchemas'] === [] ? '' : 'These products have a broken personalization setup and cannot be sold until it is fixed: ' . implode(', ', $s['brokenSchemas']),
        );
        return $out;
    }
}
