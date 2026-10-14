<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Admin;

final class MemorySettingsStore implements SettingsStore
{
    /** @param array<string,mixed> $values */
    public function __construct(public array $values = [])
    {
    }

    public function get(string $key, mixed $default = null): mixed
    {
        return $this->values[$key] ?? $default;
    }

    public function set(string $key, mixed $value): void
    {
        $this->values[$key] = $value;
    }

    public function delete(string $key): void
    {
        unset($this->values[$key]);
    }
}
