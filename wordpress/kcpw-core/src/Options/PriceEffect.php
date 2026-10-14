<?php
declare(strict_types=1);

namespace KcPrintworks\Core\Options;

/** A flat amount in cents, or basis points of the base unit price (100 bp = 1%, negative = discount). */
final class PriceEffect
{
    private function __construct(public readonly string $kind, public readonly int $value)
    {
    }

    public static function flat(int $cents): self
    {
        return new self('flat', $cents);
    }

    public static function percent(int $basisPoints): self
    {
        return new self('percent', $basisPoints);
    }

    public static function fromArray(mixed $data, string $where): ?self
    {
        if ($data === null) {
            return null;
        }
        if (!is_array($data)) {
            throw new SchemaError("$where: priceEffect must be an object.");
        }
        if (($data['kind'] ?? null) === 'flat' && is_int($data['amount'] ?? null)) {
            return self::flat($data['amount']);
        }
        if (($data['kind'] ?? null) === 'percent' && is_int($data['basisPoints'] ?? null)) {
            return self::percent($data['basisPoints']);
        }
        throw new SchemaError("$where: priceEffect must be {kind:'flat',amount} or {kind:'percent',basisPoints} with whole numbers.");
    }

    /** @return array<string,mixed> */
    public function toArray(): array
    {
        return $this->kind === 'flat'
            ? ['kind' => 'flat', 'amount' => $this->value]
            : ['kind' => 'percent', 'basisPoints' => $this->value];
    }
}
