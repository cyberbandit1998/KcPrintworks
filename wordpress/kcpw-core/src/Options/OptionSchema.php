<?php
declare(strict_types=1);

namespace KcPrintworks\Core\Options;

use KcPrintworks\Core\Support\Json;

/**
 * A product's personalization fields. Parsing follows the contract in packages/contracts/src/options.ts (the zod schema),
 * a little stricter: duplicate field ids and duplicate choice values are errors. Unknown keys are ignored, as zod does.
 */
final class OptionSchema
{
    public const MAX_FIELDS = 20;

    /** @param list<OptionField> $fields */
    private function __construct(public readonly int $version, public readonly array $fields)
    {
    }

    public static function empty(): self
    {
        return new self(1, []);
    }

    public function isEmpty(): bool
    {
        return $this->fields === [];
    }

    public function hasRequired(): bool
    {
        foreach ($this->fields as $field) {
            if ($field->required) {
                return true;
            }
        }
        return false;
    }

    /** @throws SchemaError */
    public static function fromJson(string $json): self
    {
        try {
            return self::fromDecoded(Json::decode($json));
        } catch (\JsonException $e) {
            throw new SchemaError('The personalization setup is not valid JSON.');
        }
    }

    /** @throws SchemaError */
    public static function fromDecoded(mixed $data): self
    {
        $data = Json::assoc($data);
        if (!is_array($data) || array_is_list($data) && $data !== []) {
            throw new SchemaError('The personalization setup must be an object with "version" and "fields".');
        }
        $version = $data['version'] ?? 1;
        if (!is_int($version) || $version < 1) {
            throw new SchemaError('"version" must be a whole number of 1 or more.');
        }
        $rawFields = $data['fields'] ?? [];
        if (!is_array($rawFields) || ($rawFields !== [] && !array_is_list($rawFields))) {
            throw new SchemaError('"fields" must be a list.');
        }
        if (count($rawFields) > self::MAX_FIELDS) {
            throw new SchemaError('At most ' . self::MAX_FIELDS . ' fields are allowed.');
        }
        $fields = [];
        $seen = [];
        foreach ($rawFields as $index => $raw) {
            $field = self::field($raw, 'Field ' . ($index + 1));
            if (isset($seen[$field->id])) {
                throw new SchemaError("Field ids must be unique; \"{$field->id}\" is used twice.");
            }
            $seen[$field->id] = true;
            $fields[] = $field;
        }
        return new self($version, $fields);
    }

    private static function field(mixed $raw, string $where): OptionField
    {
        if (!is_array($raw) || ($raw !== [] && array_is_list($raw))) {
            throw new SchemaError("$where must be an object.");
        }
        $id = $raw['id'] ?? null;
        if (!is_string($id) || !preg_match('/^[a-z][a-z0-9_]{0,39}$/', $id)) {
            throw new SchemaError("$where: id must be lowercase letters, digits and underscores, starting with a letter (40 characters at most).");
        }
        $where = "Field \"$id\"";
        $label = $raw['label'] ?? null;
        if (!is_string($label) || self::length($label) < 1 || self::length($label) > 80) {
            throw new SchemaError("$where: label must be 1 to 80 characters.");
        }
        $help = $raw['helpText'] ?? null;
        if ($help !== null && (!is_string($help) || self::length($help) > 300)) {
            throw new SchemaError("$where: helpText must be text of 300 characters or fewer.");
        }
        $required = $raw['required'] ?? false;
        if (!is_bool($required)) {
            throw new SchemaError("$where: required must be true or false.");
        }
        $type = $raw['type'] ?? null;
        $effect = PriceEffect::fromArray($raw['priceEffect'] ?? null, $where);

        switch ($type) {
            case OptionField::TEXT:
            case OptionField::TEXTAREA:
                $min = $raw['minLength'] ?? 0;
                $max = $raw['maxLength'] ?? null;
                if (!is_int($min) || $min < 0) {
                    throw new SchemaError("$where: minLength must be a whole number, 0 or more.");
                }
                if (!is_int($max) || $max < 1 || $max > 500) {
                    throw new SchemaError("$where: maxLength must be a whole number from 1 to 500.");
                }
                $placeholder = $raw['placeholder'] ?? null;
                if ($placeholder !== null && (!is_string($placeholder) || self::length($placeholder) > 80)) {
                    throw new SchemaError("$where: placeholder must be text of 80 characters or fewer.");
                }
                return new OptionField($id, $type, $label, $required, $help, $min, $max, $placeholder, [], $effect);
            case OptionField::SELECT:
            case OptionField::RADIO:
                $rawChoices = $raw['choices'] ?? null;
                if (!is_array($rawChoices) || !array_is_list($rawChoices) || count($rawChoices) < 1 || count($rawChoices) > 30) {
                    throw new SchemaError("$where: needs 1 to 30 choices.");
                }
                $choices = [];
                $values = [];
                foreach ($rawChoices as $n => $c) {
                    $value = is_array($c) ? ($c['value'] ?? null) : null;
                    $clabel = is_array($c) ? ($c['label'] ?? null) : null;
                    if (!is_string($value) || !preg_match('/^[a-z0-9][a-z0-9_-]{0,39}$/', $value)) {
                        throw new SchemaError("$where: choice " . ($n + 1) . ' needs a value of lowercase letters, digits, "-" or "_" (40 characters at most).');
                    }
                    if (!is_string($clabel) || self::length($clabel) < 1 || self::length($clabel) > 80) {
                        throw new SchemaError("$where: choice \"$value\" needs a label of 1 to 80 characters.");
                    }
                    if (isset($values[$value])) {
                        throw new SchemaError("$where: choice value \"$value\" is used twice.");
                    }
                    $values[$value] = true;
                    $choices[] = new Choice($value, $clabel, PriceEffect::fromArray($c['priceEffect'] ?? null, $where . ' choice "' . $value . '"'));
                }
                return new OptionField($id, $type, $label, $required, $help, 0, 0, null, $choices, null);
            case OptionField::CHECKBOX:
                return new OptionField($id, $type, $label, $required, $help, 0, 0, null, [], $effect);
        }
        throw new SchemaError("$where: type must be text, textarea, select, radio or checkbox.");
    }

    private static function length(string $value): int
    {
        return (int) preg_match_all('/./su', $value);
    }

    /** @return array{version:int,fields:list<array<string,mixed>>} */
    public function toArray(): array
    {
        return ['version' => $this->version, 'fields' => array_map(static fn (OptionField $f): array => $f->toArray(), $this->fields)];
    }

    public function toJson(): string
    {
        return Json::encode($this->toArray());
    }
}
