<?php
declare(strict_types=1);

namespace KcPrintworks\Core\Options;

final class OptionField
{
    public const TEXT = 'text';
    public const TEXTAREA = 'textarea';
    public const SELECT = 'select';
    public const RADIO = 'radio';
    public const CHECKBOX = 'checkbox';

    /** @param list<Choice> $choices */
    public function __construct(
        public readonly string $id,
        public readonly string $type,
        public readonly string $label,
        public readonly bool $required = false,
        public readonly ?string $helpText = null,
        public readonly int $minLength = 0,
        public readonly int $maxLength = 0,
        public readonly ?string $placeholder = null,
        public readonly array $choices = [],
        public readonly ?PriceEffect $priceEffect = null,
    ) {
    }

    public function isChoice(): bool
    {
        return $this->type === self::SELECT || $this->type === self::RADIO;
    }

    public function isText(): bool
    {
        return $this->type === self::TEXT || $this->type === self::TEXTAREA;
    }

    /** @return array<string,mixed> */
    public function toArray(): array
    {
        $out = ['id' => $this->id, 'type' => $this->type, 'label' => $this->label, 'required' => $this->required];
        if ($this->helpText !== null && $this->helpText !== '') {
            $out['helpText'] = $this->helpText;
        }
        if ($this->isText()) {
            $out['minLength'] = $this->minLength;
            $out['maxLength'] = $this->maxLength;
            if ($this->placeholder !== null && $this->placeholder !== '') {
                $out['placeholder'] = $this->placeholder;
            }
        }
        if ($this->isChoice()) {
            $out['choices'] = array_map(static fn (Choice $c): array => $c->toArray(), $this->choices);
        }
        if ($this->priceEffect !== null && !$this->isChoice()) {
            $out['priceEffect'] = $this->priceEffect->toArray();
        }
        return $out;
    }
}
