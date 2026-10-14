<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Model;

/** One Etsy inventory product: a combination of variation values with its SKU and offering. */
final class Variant
{
    /** @param array<string,string> $options property name => value text, in Etsy's property order */
    public function __construct(
        public readonly int $productId,
        public readonly string $sku,
        public readonly array $options,
        public readonly ?Money $price,
        public readonly int $quantity,
        public readonly bool $enabled,
        public readonly bool $deleted,
    ) {
    }

    /** A stable fingerprint of the option values, independent of case and spacing, for mapping variants. */
    public function optionsKey(): string
    {
        $pairs = [];
        foreach ($this->options as $name => $value) {
            $pairs[] = self::norm($name) . '=' . self::norm($value);
        }
        sort($pairs);
        return implode('|', $pairs);
    }

    public static function norm(string $text): string
    {
        return trim((string) preg_replace('/[^a-z0-9]+/', ' ', mb_strtolower($text)));
    }
}
