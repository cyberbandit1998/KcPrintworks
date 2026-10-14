<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Admin;

final class Download
{
    public function __construct(
        public readonly string $filename,
        public readonly string $contentType,
        public readonly string $body,
    ) {
    }
}
