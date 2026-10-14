<?php
declare(strict_types=1);

namespace KcPrintworks\Core\Options;

use KcPrintworks\Core\Support\Money;

/**
 * Server-side personalization checks. A line-for-line port of the reference in packages/contracts/src/option-logic.ts;
 * packages/contracts/test/vectors/options.json (33 cases generated from the reference) is the proof they agree.
 *
 * The SCHEMA decides what is valid and what it costs. Nothing the browser sends can change a price.
 */
final class OptionValidator
{
    /** Newlines in textareas are allowed; every other control, zero-width, and bidi character is not (written as escapes, never literally). */
    private const FORBIDDEN = '/[\x{0000}-\x{0009}\x{000B}-\x{001F}\x{007F}-\x{009F}\x{200B}-\x{200F}\x{202A}-\x{202E}\x{2066}-\x{2069}\x{FEFF}]/u';

    /** What JavaScript's String.prototype.trim removes. */
    private const TRIM = '/^[\x{0009}-\x{000D}\x{0020}\x{00A0}\x{1680}\x{2000}-\x{200A}\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}\x{FEFF}]+|[\x{0009}-\x{000D}\x{0020}\x{00A0}\x{1680}\x{2000}-\x{200A}\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}\x{FEFF}]+$/u';

    /**
     * @param mixed $input the decoded JSON "options" member: must be an object (stdClass). Anything else is rejected as a whole.
     */
    public static function validate(OptionSchema $schema, mixed $input): OptionValidation
    {
        if (!($input instanceof \stdClass)) {
            return new OptionValidation(false, [], [[
                'fieldId' => '',
                'code' => 'invalid_type',
                'message' => 'Personalization must be a set of named fields.',
            ]]);
        }
        $given = get_object_vars($input);
        $issues = [];
        $values = [];
        $known = [];
        foreach ($schema->fields as $field) {
            $known[$field->id] = true;
        }
        foreach (array_keys($given) as $key) {
            $key = (string) $key;
            if (!isset($known[$key])) {
                $issues[] = ['fieldId' => $key, 'code' => 'unknown_field', 'message' => "Unknown option \"$key\"."];
            }
        }

        foreach ($schema->fields as $field) {
            $present = array_key_exists($field->id, $given);
            $raw = $present ? $given[$field->id] : null;
            $missing = !$present || $raw === null || $raw === '';

            if ($field->type === OptionField::CHECKBOX) {
                if ($present && !is_bool($raw)) {
                    $issues[] = self::issue($field, 'invalid_type', "{$field->label} must be on or off.");
                    continue;
                }
                if ($field->required && $raw !== true) {
                    $issues[] = self::issue($field, 'required', "{$field->label} is required.");
                    continue;
                }
                if ($raw === true) {
                    $values[$field->id] = true;
                }
                continue;
            }

            if ($missing) {
                if ($field->required) {
                    $issues[] = self::issue($field, 'required', "{$field->label} is required.");
                }
                continue;
            }
            if (!is_string($raw)) {
                $issues[] = self::issue($field, 'invalid_type', "{$field->label} must be text.");
                continue;
            }

            if ($field->isChoice()) {
                $found = false;
                foreach ($field->choices as $choice) {
                    if ($choice->value === $raw) {
                        $found = true;
                        break;
                    }
                }
                if (!$found) {
                    $issues[] = self::issue($field, 'invalid_choice', "Choose one of the available options for {$field->label}.");
                    continue;
                }
                $values[$field->id] = $raw;
                continue;
            }

            // text / textarea
            $normalized = self::normalize($raw);
            if ($normalized === null || self::forbidden($normalized, $field->type === OptionField::TEXTAREA)) {
                $issues[] = self::issue($field, 'invalid_characters', "{$field->label} contains characters that cannot be printed.");
                continue;
            }
            $length = (int) preg_match_all('/./su', $normalized);
            if ($normalized === '') {
                if ($field->required) {
                    $issues[] = self::issue($field, 'required', "{$field->label} is required.");
                }
                continue;
            }
            if ($length < $field->minLength) {
                $issues[] = self::issue($field, 'too_short', "{$field->label} must be at least {$field->minLength} characters.");
                continue;
            }
            if ($length > $field->maxLength) {
                $issues[] = self::issue($field, 'too_long', "{$field->label} must be at most {$field->maxLength} characters.");
                continue;
            }
            $values[$field->id] = $normalized;
        }

        return new OptionValidation($issues === [], $values, $issues);
    }

    /** NFC, line endings to "\n", trimmed like JavaScript. Null when the text is not valid UTF-8. */
    private static function normalize(string $raw): ?string
    {
        if (preg_match('//u', $raw) !== 1) {
            return null;
        }
        if (class_exists(\Normalizer::class)) {
            $nfc = \Normalizer::normalize($raw, \Normalizer::FORM_C);
            if ($nfc === false) {
                return null;
            }
            $raw = $nfc;
        }
        $raw = (string) preg_replace('/\r\n?/', "\n", $raw);
        $trimmed = preg_replace(self::TRIM, '', $raw);
        return $trimmed === null ? null : $trimmed;
    }

    private static function forbidden(string $text, bool $allowNewline): bool
    {
        if (!$allowNewline && str_contains($text, "\n")) {
            return true;
        }
        return preg_match(self::FORBIDDEN, $text) === 1;
    }

    /** @return array{fieldId:string,code:string,message:string} */
    private static function issue(OptionField $field, string $code, string $message): array
    {
        return ['fieldId' => $field->id, 'code' => $code, 'message' => $message];
    }

    /**
     * Sum of option price effects for ONE unit, in cents. Percent effects are of the BASE unit price (the variation or
     * product price before option charges), not compounded.
     *
     * @param array<string,string|bool> $values
     */
    public static function adders(OptionSchema $schema, array $values, int $baseCents): int
    {
        $total = 0;
        foreach ($schema->fields as $field) {
            $effect = self::effectFor($field, $values[$field->id] ?? null);
            if ($effect === null) {
                continue;
            }
            $total += $effect->kind === 'flat' ? $effect->value : Money::percentOf($baseCents, $effect->value);
        }
        return $total;
    }

    private static function effectFor(OptionField $field, string|bool|null $value): ?PriceEffect
    {
        if ($value === null) {
            return null;
        }
        if ($field->isChoice()) {
            foreach ($field->choices as $choice) {
                if ($choice->value === $value) {
                    return $choice->priceEffect;
                }
            }
            return null;
        }
        if ($field->type === OptionField::CHECKBOX) {
            return $value === true ? $field->priceEffect : null;
        }
        return $value === '' ? null : $field->priceEffect;
    }

    /**
     * Readable label/value pairs in schema order: what is stored as order-item meta.
     *
     * @param array<string,string|bool> $values
     * @return list<array{fieldId:string,label:string,value:string}>
     */
    public static function summary(OptionSchema $schema, array $values): array
    {
        $out = [];
        foreach ($schema->fields as $field) {
            if (!array_key_exists($field->id, $values)) {
                continue;
            }
            $value = $values[$field->id];
            if ($field->type === OptionField::CHECKBOX) {
                if ($value === true) {
                    $out[] = ['fieldId' => $field->id, 'label' => $field->label, 'value' => 'Yes'];
                }
            } elseif ($field->isChoice()) {
                foreach ($field->choices as $choice) {
                    if ($choice->value === $value) {
                        $out[] = ['fieldId' => $field->id, 'label' => $field->label, 'value' => $choice->label];
                    }
                }
            } elseif (is_string($value) && $value !== '') {
                $out[] = ['fieldId' => $field->id, 'label' => $field->label, 'value' => $value];
            }
        }
        return $out;
    }
}
