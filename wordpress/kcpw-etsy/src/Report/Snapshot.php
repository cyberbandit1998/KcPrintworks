<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Report;

use KcPrintworks\Etsy\Etsy\Normalizer;
use KcPrintworks\Etsy\Model\Listing;

/**
 * The raw Etsy data the plugin downloads: a list of {listing, inventory, images} objects. Saved as JSON so the
 * preview can be rerun without calling Etsy, and so a sample can be shared when the response shapes need checking.
 */
final class Snapshot
{
    /**
     * @param list<array{listing:array<string,mixed>,inventory:array<string,mixed>|null,images:array<string,mixed>|null}> $items
     * @return list<Listing>
     */
    public static function listings(array $items): array
    {
        $normalizer = new Normalizer();
        $out = [];
        foreach ($items as $item) {
            $out[] = $normalizer->normalize((array) ($item['listing'] ?? []), $item['inventory'] ?? null, $item['images'] ?? null);
        }
        return $out;
    }

    /** @return list<array<string,mixed>> */
    public static function fromFile(string $path): array
    {
        $data = json_decode((string) file_get_contents($path), true);
        if (!is_array($data)) {
            throw new \RuntimeException('Snapshot is not a JSON array: ' . $path);
        }
        return array_values($data);
    }
}
