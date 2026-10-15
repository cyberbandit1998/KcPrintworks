<?php
declare(strict_types=1);

namespace KcPrintworks\Quotes\Wp;

use KcPrintworks\Quotes\Service\Health;
use KcPrintworks\Quotes\Upload\GdImageSanitizer;

/** Gathers the facts Health::checks() needs. Reads only; the one thing it writes is a small test file in the pictures folder. */
final class HealthProbe
{
    /** @return array{active:bool,testMode:?bool} */
    public static function stripe(): array
    {
        $active = class_exists('WC_Stripe') || class_exists('WC_Gateway_Stripe') || (function_exists('is_plugin_active') && is_plugin_active('woocommerce-gateway-stripe/woocommerce-gateway-stripe.php'));
        $settings = get_option('woocommerce_stripe_settings', []);
        $mode = is_array($settings) && isset($settings['testmode']) ? $settings['testmode'] === 'yes' : null;
        return ['active' => $active, 'testMode' => $active ? $mode : null];
    }

    public static function bytes(string $value): int
    {
        $value = trim($value);
        if ($value === '' || $value === '-1') {
            return 0;
        }
        $n = (int) $value;
        return match (strtolower(substr($value, -1))) {
            'g' => $n * 1024 ** 3,
            'm' => $n * 1024 ** 2,
            'k' => $n * 1024,
            default => $n,
        };
    }

    /** @return array<string,mixed> the facts, and whether the tables exist */
    public static function facts(bool $probeWeb = false): array
    {
        global $wpdb;
        $store = WpFileStore::forSite();
        $where = Config::uploadDir();
        $writable = $store->prepare();
        $reachable = null;
        if ($probeWeb && $writable && $where['insideUploads']) {
            $reachable = self::probeReachable($store, $where['dir']);
        }
        $tables = $wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', Schema::quotes())) === Schema::quotes();
        $stripe = self::stripe();
        return [
            'wooActive' => class_exists('WooCommerce'),
            'secretLength' => strlen(Config::secret()),
            'storefrontSet' => Config::storefrontUrl() !== '',
            'tablesExist' => $tables,
            'permalinks' => (string) get_option('permalink_structure') !== '',
            'https' => is_ssl() || str_starts_with((string) home_url(), 'https://'),
            'decimals' => function_exists('wc_get_price_decimals') ? (int) wc_get_price_decimals() : 2,
            'currency' => function_exists('get_woocommerce_currency') ? (string) get_woocommerce_currency() : '',
            'uploadsWritable' => $writable,
            'uploadsInsideWeb' => $where['insideUploads'],
            'uploadsReachable' => $reachable,
            'redraws' => GdImageSanitizer::available(),
            'postMaxBytes' => self::bytes((string) ini_get('post_max_size')),
            'cronScheduled' => wp_next_scheduled(Plugin::CRON_HOOK) !== false,
            'stripeActive' => $stripe['active'],
            'stripeTestMode' => $stripe['testMode'],
            'taxable' => Config::settings()->taxable,
            'notifyEmail' => Config::notifyEmail(),
        ];
    }

    /** @return list<array{label:string,status:string,detail:string}> */
    public static function checks(bool $probeWeb = false): array
    {
        return Health::checks(self::facts($probeWeb));
    }

    /** Whether a file in the pictures folder can be fetched over the web. A fetch that fails for any reason counts as "not reachable". */
    private static function probeReachable(WpFileStore $store, string $dir): ?bool
    {
        $uploads = wp_upload_dir(null, false);
        $base = (string) ($uploads['baseurl'] ?? '');
        $name = bin2hex(random_bytes(20));
        $marker = 'kcpw-quotes-probe-' . $name;
        $folder = basename($dir);
        try {
            $store->put($name, $marker);
        } catch (\Throwable) {
            return null;
        }
        try {
            $response = wp_remote_get($base . '/' . $folder . '/' . $name, ['timeout' => 5, 'redirection' => 0, 'sslverify' => true]);
            if (is_wp_error($response)) {
                return null;
            }
            return (int) wp_remote_retrieve_response_code($response) === 200 && str_contains((string) wp_remote_retrieve_body($response), $marker);
        } finally {
            $store->delete($name);
        }
    }
}
