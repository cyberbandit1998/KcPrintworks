<?php
declare(strict_types=1);

namespace KcPrintworks\Core\Options;

use KcPrintworks\Core\Support\Money;
use KcPrintworks\Core\Support\Slug;

/**
 * Turns the product-screen form into a personalization schema, and back. No WordPress here, so it is fully tested.
 *
 * Each row: id (kept from before), label, type, required, min, max, help, choices (one per line: "Label" or
 * "Label | +2.50" or "Label | +10%"), price (for text and checkbox fields: "+2.50" or "+10%"), remove.
 * Field ids and choice values are made from the labels the first time and then kept, so renaming a label later does not
 * change what an existing cart or order refers to.
 */
final class SchemaForm
{
    public const MAX_ROWS = 20;

    /**
     * @param array<int|string,mixed> $rows
     * @return array{schema:?OptionSchema,errors:list<string>}
     */
    public static function parse(array $rows, int $decimals = 2): array
    {
        $fields = [];
        $errors = [];
        $usedIds = [];
        foreach ($rows as $row) {
            if (!is_array($row) || !empty($row['remove'])) {
                continue;
            }
            $label = trim((string) ($row['label'] ?? ''));
            if ($label === '') {
                continue; // an empty row is simply ignored
            }
            $type = (string) ($row['type'] ?? 'text');
            $id = self::fieldId((string) ($row['id'] ?? ''), $label, $usedIds);
            $usedIds[$id] = true;

            $field = ['id' => $id, 'type' => $type, 'label' => $label, 'required' => !empty($row['required'])];
            $help = trim((string) ($row['help'] ?? ''));
            if ($help !== '') {
                $field['helpText'] = $help;
            }
            try {
                if ($type === 'text' || $type === 'textarea') {
                    $field['minLength'] = self::wholeNumber($row['min'] ?? '', 0);
                    $max = self::wholeNumber($row['max'] ?? '', 0);
                    if ($max < 1) {
                        throw new SchemaError('needs a maximum length of 1 or more.');
                    }
                    $field['maxLength'] = $max;
                }
                if ($type === 'select' || $type === 'radio') {
                    $field['choices'] = self::choices((string) ($row['choices'] ?? ''), $decimals);
                } else {
                    $effect = self::effect((string) ($row['price'] ?? ''), $decimals);
                    if ($effect !== null) {
                        $field['priceEffect'] = $effect;
                    }
                }
                OptionSchema::fromDecoded(['version' => 1, 'fields' => [$field]]); // per-field check for a precise message
            } catch (SchemaError $e) {
                $errors[] = "\"$label\": " . preg_replace('/^Field "[^"]*": /', '', $e->getMessage());
                continue;
            }
            $fields[] = $field;
        }
        if (count($fields) > self::MAX_ROWS) {
            $errors[] = 'At most ' . self::MAX_ROWS . ' fields are allowed.';
        }
        if ($errors !== []) {
            return ['schema' => null, 'errors' => $errors];
        }
        try {
            return ['schema' => OptionSchema::fromDecoded(['version' => 1, 'fields' => $fields]), 'errors' => []];
        } catch (SchemaError $e) {
            return ['schema' => null, 'errors' => [$e->getMessage()]];
        }
    }

    /** @param array<string,true> $used */
    private static function fieldId(string $existing, string $label, array $used): string
    {
        if (preg_match('/^[a-z][a-z0-9_]{0,39}$/', $existing) && !isset($used[$existing])) {
            return $existing;
        }
        $base = str_replace('-', '_', Slug::of($label));
        $base = preg_replace('/^[^a-z]+/', '', $base) ?? '';
        $base = substr($base === '' ? 'field' : $base, 0, 36);
        $id = $base;
        for ($n = 2; isset($used[$id]); $n++) {
            $id = $base . '_' . $n;
        }
        return $id;
    }

    private static function wholeNumber(mixed $value, int $default): int
    {
        $value = trim((string) $value);
        if ($value === '') {
            return $default;
        }
        if (!ctype_digit($value) || strlen($value) > 4) {
            throw new SchemaError('lengths must be whole numbers.');
        }
        return (int) $value;
    }

    /** @return list<array<string,mixed>> */
    private static function choices(string $text, int $decimals): array
    {
        $out = [];
        $taken = [];
        foreach (preg_split('/\R/u', $text) ?: [] as $line) {
            $line = trim($line);
            if ($line === '') {
                continue;
            }
            [$label, $price] = array_pad(array_map('trim', explode('|', $line, 2)), 2, '');
            if ($label === '') {
                throw new SchemaError('every choice needs a name before the "|".');
            }
            $base = substr(Slug::of($label), 0, 36);
            $base = $base === '' ? 'option' : $base;
            $value = $base;
            for ($n = 2; isset($taken[$value]); $n++) {
                $value = $base . '-' . $n;
            }
            $taken[$value] = true;
            $choice = ['value' => $value, 'label' => $label];
            $effect = self::effect($price, $decimals);
            if ($effect !== null) {
                $choice['priceEffect'] = $effect;
            }
            $out[] = $choice;
        }
        if ($out === []) {
            throw new SchemaError('needs at least one choice (one per line).');
        }
        return $out;
    }

    /** "+2.50" / "2.5" / "-1" -> flat cents;  "+10%" / "-5%" / "12.5%" -> basis points. Empty -> none. */
    public static function effect(string $text, int $decimals = 2): ?array
    {
        $text = trim($text);
        if ($text === '' || $text === '0') {
            return null;
        }
        if (!preg_match('/^([+-]?)\s*(\d{1,7}(?:\.\d{1,4})?)\s*(%?)$/', $text, $m)) {
            throw new SchemaError("\"$text\" is not a price change. Use something like +2.50 or +10%.");
        }
        $sign = $m[1] === '-' ? -1 : 1;
        if ($m[3] === '%') {
            $bp = Money::parse($m[2], 2); // "12.5" -> 1250 basis points
            if ($bp === null || $bp > 100_000) {
                throw new SchemaError("\"$text\" is too large.");
            }
            return $bp === 0 ? null : ['kind' => 'percent', 'basisPoints' => $sign * $bp];
        }
        $cents = Money::parse($m[2], $decimals);
        if ($cents === null || $cents > 10_000_000) {
            throw new SchemaError("\"$text\" is not a valid amount.");
        }
        return $cents === 0 ? null : ['kind' => 'flat', 'amount' => $sign * $cents];
    }

    /** The inverse of effect(), for showing an existing setting in the form. */
    public static function formatEffect(?PriceEffect $effect, int $decimals = 2): string
    {
        if ($effect === null) {
            return '';
        }
        $sign = $effect->value < 0 ? '-' : '+';
        $abs = abs($effect->value);
        return $effect->kind === 'flat'
            ? $sign . Money::format($abs, $decimals)
            : $sign . rtrim(rtrim(Money::format($abs, 2), '0'), '.') . '%';
    }
}
