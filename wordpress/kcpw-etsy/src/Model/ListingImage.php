<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Model;

final class ListingImage
{
    public function __construct(
        public readonly int $id,
        public readonly int $rank,
        public readonly string $url,
        public readonly string $alt,
    ) {
    }

    public function filename(): string
    {
        $path = (string) parse_url($this->url, PHP_URL_PATH);
        return basename($path);
    }
}
