<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Wp;

use KcPrintworks\Etsy\Admin\SettingsStore;

final class WpSettingsStore implements SettingsStore
{
    public const OPTION = 'kcpw_etsy_settings';

    public function get(string $key, mixed $default = null): mixed
    {
        $all = \get_option(self::OPTION, []);
        return is_array($all) && array_key_exists($key, $all) ? $all[$key] : $default;
    }

    public function set(string $key, mixed $value): void
    {
        $all = \get_option(self::OPTION, []);
        $all = is_array($all) ? $all : [];
        $all[$key] = $value;
        \update_option(self::OPTION, $all, false);
    }

    public function delete(string $key): void
    {
        $all = \get_option(self::OPTION, []);
        if (is_array($all) && array_key_exists($key, $all)) {
            unset($all[$key]);
            \update_option(self::OPTION, $all, false);
        }
    }
}
