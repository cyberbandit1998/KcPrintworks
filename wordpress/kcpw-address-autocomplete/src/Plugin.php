<?php
declare(strict_types=1);

namespace KcPrintworks\AddressAutocomplete;

/** Wires the pieces to WordPress. Holds no logic of its own: every decision lives in a class that is tested without WordPress. */
final class Plugin
{
    public static function boot(string $file, string $version): void
    {
        $settings = Settings::load(get_option(Settings::OPTION, []));
        $forms = FormConfig::sanitizeList(get_option(FormConfig::OPTION, []));
        $effective = Settings::effective(
            $settings,
            defined('KCPW_AA_BROWSER_KEY') ? constant('KCPW_AA_BROWSER_KEY') : null,
            defined('KCPW_AA_SERVER_KEY') ? constant('KCPW_AA_SERVER_KEY') : null,
        );

        (new Frontend($file, $version, $effective, $forms))->register();
        (new Rest($effective))->register();
        if (is_admin()) {
            (new Admin($file, $version, $settings, $forms))->register();
        }
    }
}
