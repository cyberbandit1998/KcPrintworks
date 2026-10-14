<?php
declare(strict_types=1);

namespace KcPrintworks\Core\Cart;

/**
 * What the shopper wants for one cart line: never a price. Parsing is strict (packages/contracts/src/cart.ts):
 * an unexpected key such as "price" rejects the whole line instead of being ignored.
 */
final class LineIntent
{
    public const MAX_QUANTITY = 99;
    private const KEYS = ['productId', 'variationId', 'attributes', 'quantity', 'options'];

    /** @param array<string,string> $attributes */
    public function __construct(
        public readonly int $productId,
        public readonly ?int $variationId,
        public readonly array $attributes,
        public readonly int $quantity,
        public readonly \stdClass $options,
    ) {
    }

    /** @throws RequestError */
    public static function parse(mixed $raw, int $index): self
    {
        $where = 'Line ' . ($index + 1);
        if (!($raw instanceof \stdClass)) {
            throw new RequestError(["$where must be an object."]);
        }
        $problems = [];
        $data = get_object_vars($raw);
        foreach (array_keys($data) as $key) {
            if (!in_array((string) $key, self::KEYS, true)) {
                $problems[] = "$where has an unexpected field \"$key\".";
            }
        }
        $productId = $data['productId'] ?? null;
        if (!is_int($productId) || $productId < 1) {
            $problems[] = "$where: productId must be a positive whole number.";
        }
        $variationId = $data['variationId'] ?? null;
        if ($variationId !== null && (!is_int($variationId) || $variationId < 1)) {
            $problems[] = "$where: variationId must be a positive whole number.";
        }
        $quantity = $data['quantity'] ?? null;
        if (!is_int($quantity) || $quantity < 1 || $quantity > self::MAX_QUANTITY) {
            $problems[] = "$where: quantity must be a whole number from 1 to " . self::MAX_QUANTITY . '.';
        }
        $attributes = [];
        if (array_key_exists('attributes', $data)) {
            if (!($data['attributes'] instanceof \stdClass)) {
                $problems[] = "$where: attributes must be an object.";
            } else {
                foreach (get_object_vars($data['attributes']) as $slug => $option) {
                    if (!is_string($option) || strlen($option) > 100) {
                        $problems[] = "$where: attribute \"$slug\" must be text of 100 characters or fewer.";
                    } else {
                        $attributes[(string) $slug] = $option;
                    }
                }
            }
        }
        $options = new \stdClass();
        if (array_key_exists('options', $data)) {
            if (!($data['options'] instanceof \stdClass)) {
                $problems[] = "$where: options must be an object.";
            } else {
                foreach (get_object_vars($data['options']) as $field => $value) {
                    if (!is_bool($value) && (!is_string($value) || strlen($value) > 4000)) {
                        $problems[] = "$where: option \"$field\" must be text (up to 1,000 characters) or true/false.";
                    }
                }
                $options = $data['options'];
            }
        }
        if ($problems !== []) {
            throw new RequestError($problems);
        }
        return new self($productId, $variationId, $attributes, $quantity, $options);
    }

    /** Same idea as lineKey() in the storefront: identical choices merge, different choices never do. */
    public function key(): string
    {
        $entries = static function (array $record): array {
            $out = [];
            foreach ($record as $k => $v) {
                if ($v !== '' && $v !== false) {
                    $out[] = [(string) $k, $v];
                }
            }
            usort($out, static fn (array $a, array $b): int => strcmp($a[0], $b[0]));
            return $out;
        };
        return (string) json_encode([$this->productId, $this->variationId ?? 0, $entries($this->attributes), $entries(get_object_vars($this->options))], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    }
}
