<?php
declare(strict_types=1);

namespace KcPrintworks\Core\Options;

final class Choice
{
    public function __construct(
        public readonly string $value,
        public readonly string $label,
        public readonly ?PriceEffect $priceEffect = null,
    ) {
    }

    /** @return array<string,mixed> */
    public function toArray(): array
    {
        return ['value' => $this->value, 'label' => $this->label] + ($this->priceEffect ? ['priceEffect' => $this->priceEffect->toArray()] : []);
    }
}
