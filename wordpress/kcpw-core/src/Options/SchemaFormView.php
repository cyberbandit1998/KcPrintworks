<?php
declare(strict_types=1);

namespace KcPrintworks\Core\Options;

/** The HTML for the personalization editor on the product screen. Escapes everything; no WordPress functions. */
final class SchemaFormView
{
    private const TYPES = [
        'text' => 'Short text',
        'textarea' => 'Long text',
        'select' => 'Choice (dropdown)',
        'radio' => 'Choice (buttons)',
        'checkbox' => 'Checkbox',
    ];

    /** @param list<string> $errors */
    public static function render(OptionSchema $schema, array $errors = [], int $decimals = 2, int $spareRows = 2): string
    {
        $e = static fn (string $s): string => htmlspecialchars($s, ENT_QUOTES, 'UTF-8');
        $html = '';
        if ($errors !== []) {
            $html .= '<div class="notice notice-error inline"><p><strong>The personalization was not saved:</strong></p><ul>';
            foreach ($errors as $error) {
                $html .= '<li>' . $e($error) . '</li>';
            }
            $html .= '</ul></div>';
        }
        $html .= '<p>Fields the shopper fills in for this product (a name, a color, a checkbox). Each field is saved with the order item and checked on the server. Leave all rows empty for a product that is not personalized.</p>';
        $html .= '<table class="widefat striped" style="max-width:62rem"><caption class="screen-reader-text">Personalization fields</caption><thead><tr>'
            . '<th scope="col">Label shoppers see</th><th scope="col">Type</th><th scope="col">Required</th><th scope="col">Length (min / max)</th>'
            . '<th scope="col">Choices, one per line ("Name | +2.50" adds a price)</th><th scope="col">Extra charge</th><th scope="col">Help text</th><th scope="col">Remove</th></tr></thead><tbody>';
        $i = 0;
        foreach ($schema->fields as $field) {
            $html .= self::row($i++, $field, $decimals, $e);
        }
        $rows = min(SchemaForm::MAX_ROWS, $i + $spareRows);
        for (; $i < $rows; $i++) {
            $html .= self::row($i, null, $decimals, $e);
        }
        return $html . '</tbody></table>';
    }

    private static function row(int $i, ?OptionField $f, int $decimals, callable $e): string
    {
        $name = static fn (string $key): string => 'kcpw_fields[' . $i . '][' . $key . ']';
        $type = $f?->type ?? 'text';
        $choices = '';
        if ($f !== null && $f->isChoice()) {
            $lines = [];
            foreach ($f->choices as $c) {
                $price = SchemaForm::formatEffect($c->priceEffect, $decimals);
                $lines[] = $c->label . ($price !== '' ? ' | ' . $price : '');
            }
            $choices = implode("\n", $lines);
        }
        $label = $f !== null ? $f->label : '';
        $aria = $label !== '' ? ' aria-label="' . $e($label) . '"' : '';
        $options = '';
        foreach (self::TYPES as $value => $text) {
            $options .= '<option value="' . $value . '"' . ($type === $value ? ' selected' : '') . '>' . $e($text) . '</option>';
        }
        return '<tr>'
            . '<td><input type="hidden" name="' . $name('id') . '" value="' . $e($f?->id ?? '') . '">'
            . '<input type="text" name="' . $name('label') . '" value="' . $e($label) . '" maxlength="80" aria-label="Label, field ' . ($i + 1) . '"></td>'
            . '<td><select name="' . $name('type') . '"' . $aria . '>' . $options . '</select></td>'
            . '<td><input type="checkbox" name="' . $name('required') . '" value="1"' . ($f?->required ? ' checked' : '') . ' aria-label="Required, field ' . ($i + 1) . '"></td>'
            . '<td><input type="number" min="0" max="500" style="width:4.5em" name="' . $name('min') . '" value="' . ($f !== null && $f->isText() ? (string) $f->minLength : '') . '" aria-label="Minimum length, field ' . ($i + 1) . '"> / '
            . '<input type="number" min="1" max="500" style="width:4.5em" name="' . $name('max') . '" value="' . ($f !== null && $f->isText() ? (string) $f->maxLength : '') . '" aria-label="Maximum length, field ' . ($i + 1) . '"></td>'
            . '<td><textarea rows="3" cols="28" name="' . $name('choices') . '" aria-label="Choices, field ' . ($i + 1) . '">' . $e($choices) . '</textarea></td>'
            . '<td><input type="text" style="width:6em" name="' . $name('price') . '" value="' . $e($f !== null && !$f->isChoice() ? SchemaForm::formatEffect($f->priceEffect, $decimals) : '') . '" aria-label="Extra charge, field ' . ($i + 1) . '"></td>'
            . '<td><input type="text" name="' . $name('help') . '" value="' . $e($f?->helpText ?? '') . '" maxlength="300" aria-label="Help text, field ' . ($i + 1) . '"></td>'
            . '<td>' . ($f !== null ? '<input type="checkbox" name="' . $name('remove') . '" value="1" aria-label="Remove field ' . ($i + 1) . '">' : '') . '</td>'
            . '</tr>';
    }
}
