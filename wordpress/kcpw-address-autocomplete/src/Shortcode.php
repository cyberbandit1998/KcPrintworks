<?php
declare(strict_types=1);

namespace KcPrintworks\AddressAutocomplete;

/**
 * [kcpw_address_autocomplete]: a ready-made address field for any page, post or widget (Elementor, the block editor's shortcode block
 * and classic widgets all run shortcodes). It prints an ordinary text input; when the plugin is active for this visitor the field also
 * gets suggestions and fills hidden or visible city/state/postcode/country fields that travel with the form.
 *
 *   [kcpw_address_autocomplete label="Delivery address" name="delivery" fields="visible" required="yes"]
 *
 *   label        the label above the field (default "Address")
 *   placeholder  hint text inside the field
 *   name         the field's name when the form is sent (letters, digits, underscore; default "address")
 *   fields       hidden (default: city, state, postcode, country travel as hidden fields), visible (shown as editable fields), none
 *   mode         smart (default) or single (the whole address in the one field)
 *   required     yes or no
 *   class        extra CSS classes for the wrapper
 *
 * When the plugin is Off, in Preview for a customer, or has no key, the shortcode still prints the plain input: a form never breaks.
 */
final class Shortcode
{
    public const TAG = 'kcpw_address_autocomplete';

    private int $count = 0;

    public function __construct(private readonly Frontend $frontend)
    {
    }

    public function register(): void
    {
        add_shortcode(self::TAG, [$this, 'render']);
    }

    /** @param array<string, mixed>|string $atts */
    public function render(array|string $atts = []): string
    {
        $a = self::atts(is_array($atts) ? $atts : []);
        $this->count++;
        $id = 'kcpw-aa-sc-' . $this->count;
        $name = $a['name'];

        $parts = [
            'address2' => [$name . '_line2', __('Apartment, suite (optional)', 'kcpw-address-autocomplete')],
            'city' => [$name . '_city', __('City', 'kcpw-address-autocomplete')],
            'state' => [$name . '_state', __('State or province', 'kcpw-address-autocomplete')],
            'postcode' => [$name . '_postcode', __('Postal code', 'kcpw-address-autocomplete')],
            'country' => [$name . '_country', __('Country', 'kcpw-address-autocomplete')],
        ];

        $out = '<div class="kcpw-aa-sc' . ($a['class'] !== '' ? ' ' . Html::a($a['class']) : '') . '" id="' . Html::a($id) . '">';
        $out .= '<label for="' . Html::a($id) . '-address">' . Html::h($a['label']) . '</label>';
        $out .= '<input type="text" class="kcpw-aa-sc__input" id="' . Html::a($id) . '-address" name="' . Html::a($name) . '" autocomplete="street-address"' . ($a['placeholder'] !== '' ? ' placeholder="' . Html::a($a['placeholder']) . '"' : '') . ($a['required'] ? ' required' : '') . '>';
        if ($a['fields'] !== 'none' && $a['mode'] === 'smart') {
            foreach ($parts as $key => [$fieldName, $label]) {
                if ($a['fields'] === 'visible') {
                    $out .= '<label for="' . Html::a($id) . '-' . $key . '">' . Html::h($label) . '</label><input type="text" id="' . Html::a($id) . '-' . $key . '" name="' . Html::a($fieldName) . '" autocomplete="off">';
                } else {
                    $out .= '<input type="hidden" id="' . Html::a($id) . '-' . $key . '" name="' . Html::a($fieldName) . '">';
                }
            }
        }
        $out .= '</div>';

        if ($this->frontend->allowed()) {
            $fields = ['address' => '#' . $id . '-address', 'address2' => '', 'city' => '', 'state' => '', 'postcode' => '', 'country' => ''];
            if ($a['fields'] !== 'none' && $a['mode'] === 'smart') {
                foreach (array_keys($parts) as $key) {
                    $fields[$key] = '#' . $id . '-' . $key;
                }
            }
            $form = FormConfig::sanitize([
                'id' => 'sc_' . $this->count,
                'name' => 'Shortcode ' . $this->count,
                'mode' => $a['mode'],
                'groups' => [['label' => 'Shortcode', 'scope' => '#' . $id, 'fields' => $fields]],
                'pages' => ['mode' => 'all'],
            ]);
            if ($form !== null) {
                $this->frontend->addShortcodeForm($form);
            }
        }
        return $out;
    }

    /**
     * @param array<string, mixed> $raw
     * @return array{label: string, placeholder: string, name: string, fields: string, mode: string, required: bool, class: string}
     */
    public static function atts(array $raw): array
    {
        $text = static fn (mixed $v, int $max): string => mb_substr(trim(preg_replace('/[\x00-\x1f\x7f]+/', ' ', strip_tags(is_scalar($v) ? (string) $v : '')) ?? ''), 0, $max);
        $name = strtolower($text($raw['name'] ?? '', 40));
        $classes = array_filter(explode(' ', $text($raw['class'] ?? '', 120)), static fn (string $c): bool => preg_match('/^[A-Za-z0-9_\-]{1,40}$/', $c) === 1);
        return [
            'label' => $text($raw['label'] ?? '', 80) ?: __('Address', 'kcpw-address-autocomplete'),
            'placeholder' => $text($raw['placeholder'] ?? '', 80),
            'name' => preg_match('/^[a-z][a-z0-9_]{0,39}$/', $name) === 1 ? $name : 'address',
            'fields' => in_array($raw['fields'] ?? '', ['hidden', 'visible', 'none'], true) ? (string) $raw['fields'] : 'hidden',
            'mode' => ($raw['mode'] ?? '') === 'single' ? 'single' : 'smart',
            'required' => in_array(strtolower((string) ($raw['required'] ?? '')), ['yes', 'true', '1'], true),
            'class' => implode(' ', $classes),
        ];
    }
}
