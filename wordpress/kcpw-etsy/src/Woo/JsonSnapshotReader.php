<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Woo;

/**
 * Reads a WooCommerce REST v3 style snapshot (the output of scripts/discovery/fetch-wc-catalog.mjs, or the REST API
 * itself): an array of products with `variation_details`. Real slugs, permalinks, and Etsy meta come from here.
 */
final class JsonSnapshotReader implements WooReader
{
    /** @param list<array<string,mixed>> $products */
    public function __construct(private readonly array $products)
    {
    }

    public static function fromFile(string $path): self
    {
        $data = json_decode((string) file_get_contents($path), true);
        if (!is_array($data)) {
            throw new \RuntimeException('Snapshot is not a JSON array: ' . $path);
        }
        return new self(array_values($data));
    }

    public function products(): array
    {
        $out = [];
        foreach ($this->products as $p) {
            $variations = [];
            foreach ((array) ($p['variation_details'] ?? []) as $v) {
                $attributes = [];
                foreach ((array) ($v['attributes'] ?? []) as $a) {
                    $attributes[(string) ($a['name'] ?? '')] = (string) ($a['option'] ?? '');
                }
                $variations[] = new WooVariation(
                    (int) ($v['id'] ?? 0),
                    (string) ($v['sku'] ?? ''),
                    $attributes,
                    Text::cents((string) ($v['price'] ?? '')),
                    (string) ($v['status'] ?? 'publish'),
                    (string) ($v['stock_status'] ?? 'instock'),
                    $this->metaInt($v, '_kcpw_etsy_product_id'),
                );
            }
            $attributes = [];
            foreach ((array) ($p['attributes'] ?? []) as $a) {
                $attributes[(string) ($a['name'] ?? '')] = implode(', ', array_map('strval', (array) ($a['options'] ?? [])));
            }
            $images = [];
            foreach ((array) ($p['images'] ?? []) as $i) {
                $images[] = basename((string) parse_url((string) ($i['src'] ?? ''), PHP_URL_PATH));
            }
            $out[] = new WooProduct(
                (int) ($p['id'] ?? 0),
                (string) ($p['type'] ?? 'simple'),
                (string) ($p['status'] ?? 'publish'),
                trim(Text::decode((string) ($p['name'] ?? ''))),
                (string) ($p['slug'] ?? ''),
                (string) ($p['sku'] ?? ''),
                (string) ($p['description'] ?? ''),
                Text::cents((string) ($p['price'] ?? '')),
                Text::cents((string) ($p['regular_price'] ?? '')),
                $images,
                array_values(array_map(static fn ($c): string => (string) ($c['name'] ?? ''), (array) ($p['categories'] ?? []))),
                $attributes,
                $variations,
                $this->metaInt($p, '_kcpw_etsy_listing_id'),
                (string) ($p['date_modified'] ?? ''),
                (bool) ($p['manage_stock'] ?? false),
            );
        }
        return $out;
    }

    /** @param array<string,mixed> $item */
    private function metaInt(array $item, string $key): ?int
    {
        foreach ((array) ($item['meta_data'] ?? []) as $meta) {
            if (($meta['key'] ?? '') === $key && is_numeric($meta['value'] ?? null)) {
                return (int) $meta['value'];
            }
        }
        return null;
    }
}
