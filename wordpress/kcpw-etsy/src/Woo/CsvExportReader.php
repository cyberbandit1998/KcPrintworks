<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Woo;

/**
 * Reads a WooCommerce product CSV export (Products > Export). Used by the command line preview and the tests.
 * Quirks it handles (see docs/discovery/INVENTORY.md): early rows are shorter than the header; in variation rows
 * `Parent` is the parent's SKU or `id:<n>`; names carry HTML entities; descriptions use a literal backslash-n.
 */
final class CsvExportReader implements WooReader
{
    public function __construct(private readonly string $csv)
    {
    }

    public static function fromFile(string $path): self
    {
        $csv = file_get_contents($path);
        if ($csv === false) {
            throw new \RuntimeException('Cannot read ' . $path);
        }
        return new self($csv);
    }

    public function products(): array
    {
        $rows = $this->rows();
        $tops = [];
        $byId = [];
        $bySku = [];
        foreach ($rows as $row) {
            if (in_array($row['Type'], ['simple', 'variable'], true)) {
                $tops[] = $row;
                $byId[$row['ID']] = $row;
                if ($row['SKU'] !== '') {
                    $bySku[$row['SKU']] = $row;
                }
            }
        }
        $children = [];
        foreach ($rows as $row) {
            if ($row['Type'] !== 'variation') {
                continue;
            }
            $parent = $byId[preg_replace('/^id:/', '', $row['Parent']) ?? ''] ?? $bySku[$row['Parent']] ?? null;
            if ($parent !== null) {
                $children[$parent['ID']][] = $row;
            }
        }

        $products = [];
        foreach ($tops as $row) {
            $variations = [];
            foreach ($children[$row['ID']] ?? [] as $child) {
                $attributes = [];
                foreach ($this->attributes($child) as $name => $value) {
                    $attributes[$name] = Text::decode($value);
                }
                $variations[] = new WooVariation(
                    (int) $child['ID'],
                    $child['SKU'],
                    $attributes,
                    $this->effectiveCents($child),
                    $child['Published'] === '1' ? 'publish' : 'private',
                    $child['In stock?'] === '0' ? 'outofstock' : 'instock',
                );
            }
            $images = [];
            foreach (preg_split('/,\s*(?=https?:\/\/|\/)/', $row['Images']) ?: [] as $url) {
                $url = trim($url);
                if ($url !== '') {
                    $images[] = basename((string) parse_url($url, PHP_URL_PATH));
                }
            }
            $products[] = new WooProduct(
                (int) $row['ID'],
                $row['Type'],
                $this->status($row),
                trim(Text::decode($row['Name'])),
                '',
                $row['SKU'],
                $row['Description'],
                $this->effectiveCents($row),
                Text::cents($row['Regular price']),
                $images,
                array_values(array_filter(array_map('trim', explode(',', $row['Categories'])))),
                $this->attributes($row),
                $variations,
                null,
                '',
                $row['Stock'] !== '',
            );
        }
        return $products;
    }

    /** @param array<string,string> $row */
    private function status(array $row): string
    {
        return $row['Published'] === '1' ? 'publish' : ($row['Published'] === '-1' ? 'private' : 'draft');
    }

    /** @param array<string,string> $row */
    private function effectiveCents(array $row): ?int
    {
        return Text::cents($row['Sale price']) ?? Text::cents($row['Regular price']);
    }

    /**
     * @param array<string,string> $row
     * @return array<string,string>
     */
    private function attributes(array $row): array
    {
        $out = [];
        for ($i = 1; $i <= 12; $i++) {
            $name = trim($row['Attribute ' . $i . ' name'] ?? '');
            if ($name !== '') {
                $out[Text::decode($name)] = trim($row['Attribute ' . $i . ' value(s)'] ?? '');
            }
        }
        return $out;
    }

    /** @return list<array<string,string>> */
    private function rows(): array
    {
        $stream = fopen('php://temp', 'r+');
        fwrite($stream, preg_replace('/^\xEF\xBB\xBF/', '', $this->csv) ?? $this->csv);
        rewind($stream);
        $header = fgetcsv($stream, 0, ',', '"', '');
        if (!is_array($header)) {
            return [];
        }
        $rows = [];
        while (($record = fgetcsv($stream, 0, ',', '"', '')) !== false) {
            if ($record === [null] || (count($record) === 1 && $record[0] === '')) {
                continue;
            }
            $row = [];
            foreach ($header as $i => $name) {
                $row[(string) $name] = (string) ($record[$i] ?? '');
            }
            foreach (['ID', 'Type', 'SKU', 'Name', 'Published', 'In stock?', 'Stock', 'Sale price', 'Regular price', 'Categories', 'Images', 'Parent', 'Description'] as $needed) {
                $row[$needed] ??= '';
            }
            $rows[] = $row;
        }
        fclose($stream);
        return $rows;
    }
}
