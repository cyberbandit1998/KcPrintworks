<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Admin;

final class EmptyMappingStore implements MappingStore
{
    public function all(): array
    {
        return [];
    }
}
