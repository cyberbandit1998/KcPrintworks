<?php
declare(strict_types=1);

namespace KcPrintworks\AddressAutocomplete;

/** Wires the pieces to WordPress. Holds no logic of its own: every decision lives in a class that is tested without WordPress. */
final class Plugin
{
    public static function boot(string $file, string $version): void
    {
        $store = Store::load();
        $effective = $store->effective();

        $frontend = new Frontend($file, $version, $effective, $store->forms);
        $frontend->register();
        (new Shortcode($frontend))->register();
        (new Picker($file, $version))->register();
        (new Rest($effective, null, null, defined('KCPW_AA_VALIDATION_CACHE_SECONDS') ? (int) constant('KCPW_AA_VALIDATION_CACHE_SECONDS') : null))->register();
        (new WooCommerce($effective))->register();
        if (is_admin()) {
            (new Admin($file, $version, $store))->register();
            (new AdminForms($store))->register();
        }
    }
}
