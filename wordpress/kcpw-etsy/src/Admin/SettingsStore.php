<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Admin;

/** Non-secret plugin settings and status (shop id, last connection test). Never holds tokens. */
interface SettingsStore
{
    public function get(string $key, mixed $default = null): mixed;

    public function set(string $key, mixed $value): void;

    public function delete(string $key): void;
}
