<?php
declare(strict_types=1);

namespace KcPrintworks\AddressAutocomplete;

/**
 * Ready-made field maps for the forms people ask about. A preset is only a starting point: the selectors are written from the
 * publicly documented markup of each plugin and have NOT been checked against a live copy of any of them (the Visual Selector
 * Tool is the way to correct one in a minute). The WooCommerce Checkout Block ids are the ones the block's own address form prints
 * (`shipping-address_1`, `billing-city`, ...); the classic checkout uses WooCommerce's long-standing `billing_address_1` ids.
 */
final class Presets
{
    /** The six places an address can land. `address` is the field the visitor types in; the others are filled when "smart" mapping is on. */
    public const FIELDS = ['address', 'address2', 'city', 'state', 'postcode', 'country'];

    /**
     * @return array<string, array{label: string, help: string, pages: array<string, mixed>, groups: list<array{label: string, fields: array<string, string>}>}>
     */
    public static function all(): array
    {
        return [
            'woo_block' => [
                'label' => 'WooCommerce Checkout Block (the new checkout)',
                'help' => 'Shipping and billing address of the block-based checkout. Recommended for stores whose checkout page shows "Contact information" and "Shipping address" steps.',
                'pages' => ['mode' => 'checkout', 'ids' => [], 'paths' => [], 'account_address' => false],
                'groups' => [
                    ['label' => 'Shipping address', 'fields' => self::wooBlock('shipping')],
                    ['label' => 'Billing address', 'fields' => self::wooBlock('billing')],
                ],
            ],
            'woo_classic' => [
                'label' => 'WooCommerce classic checkout and My Account addresses',
                'help' => 'The shortcode-based checkout and the Edit address screens of My Account.',
                'pages' => ['mode' => 'checkout', 'ids' => [], 'paths' => [], 'account_address' => true],
                'groups' => [
                    ['label' => 'Billing address', 'fields' => self::wooClassic('billing')],
                    ['label' => 'Shipping address', 'fields' => self::wooClassic('shipping')],
                ],
            ],
            'cf7' => [
                'label' => 'Contact Form 7',
                'help' => 'Expects fields named address, city, state, zip and country. Rename yours to match, or correct the selectors with the Visual Selector Tool.',
                'pages' => ['mode' => 'all', 'ids' => [], 'paths' => [], 'account_address' => false],
                'groups' => [['label' => 'Form', 'fields' => [
                    'address' => 'form.wpcf7-form [name="address"]',
                    'address2' => '',
                    'city' => 'form.wpcf7-form [name="city"]',
                    'state' => 'form.wpcf7-form [name="state"]',
                    'postcode' => 'form.wpcf7-form [name="zip"]',
                    'country' => 'form.wpcf7-form [name="country"]',
                ]]],
            ],
            'wpforms' => [
                'label' => 'WPForms (Address field)',
                'help' => 'The Address field of WPForms: street, apartment, city, state, postal code, country.',
                'pages' => ['mode' => 'all', 'ids' => [], 'paths' => [], 'account_address' => false],
                'groups' => [['label' => 'Address field', 'fields' => [
                    'address' => '.wpforms-field-address input[name$="[address1]"]',
                    'address2' => '.wpforms-field-address input[name$="[address2]"]',
                    'city' => '.wpforms-field-address input[name$="[city]"]',
                    'state' => '.wpforms-field-address [name$="[state]"]',
                    'postcode' => '.wpforms-field-address input[name$="[postal]"]',
                    'country' => '.wpforms-field-address select[name$="[country]"]',
                ]]],
            ],
            'gravity' => [
                'label' => 'Gravity Forms (Address field)',
                'help' => 'The Address field of Gravity Forms (inputs end in _1 street, _2 line 2, _3 city, _4 state, _5 ZIP, _6 country).',
                'pages' => ['mode' => 'all', 'ids' => [], 'paths' => [], 'account_address' => false],
                'groups' => [['label' => 'Address field', 'fields' => [
                    'address' => '.ginput_container_address input[id$="_1"]',
                    'address2' => '.ginput_container_address input[id$="_2"]',
                    'city' => '.ginput_container_address input[id$="_3"]',
                    'state' => '.ginput_container_address [id$="_4"]',
                    'postcode' => '.ginput_container_address input[id$="_5"]',
                    'country' => '.ginput_container_address select[id$="_6"]',
                ]]],
            ],
            'elementor' => [
                'label' => 'Elementor Pro form',
                'help' => 'Expects field IDs address, city, state, zip and country (set in each field\'s Advanced tab).',
                'pages' => ['mode' => 'all', 'ids' => [], 'paths' => [], 'account_address' => false],
                'groups' => [['label' => 'Form', 'fields' => [
                    'address' => '.elementor-form #form-field-address',
                    'address2' => '',
                    'city' => '.elementor-form #form-field-city',
                    'state' => '.elementor-form #form-field-state',
                    'postcode' => '.elementor-form #form-field-zip',
                    'country' => '.elementor-form #form-field-country',
                ]]],
            ],
            'fluent' => [
                'label' => 'Fluent Forms (Address field)',
                'help' => 'The Address field of Fluent Forms.',
                'pages' => ['mode' => 'all', 'ids' => [], 'paths' => [], 'account_address' => false],
                'groups' => [['label' => 'Address field', 'fields' => [
                    'address' => '.frm-fluent-form input[name$="[address_line_1]"]',
                    'address2' => '.frm-fluent-form input[name$="[address_line_2]"]',
                    'city' => '.frm-fluent-form input[name$="[city]"]',
                    'state' => '.frm-fluent-form [name$="[state]"]',
                    'postcode' => '.frm-fluent-form input[name$="[zip]"]',
                    'country' => '.frm-fluent-form select[name$="[country]"]',
                ]]],
            ],
            'ninja' => [
                'label' => 'Ninja Forms',
                'help' => 'Expects fields whose keys are address, city, state, zip and country.',
                'pages' => ['mode' => 'all', 'ids' => [], 'paths' => [], 'account_address' => false],
                'groups' => [['label' => 'Form', 'fields' => [
                    'address' => '.nf-form-cont .address-container input',
                    'address2' => '',
                    'city' => '.nf-form-cont .city-container input',
                    'state' => '.nf-form-cont .state-container input, .nf-form-cont .state-container select',
                    'postcode' => '.nf-form-cont .zip-container input',
                    'country' => '.nf-form-cont .country-container select',
                ]]],
            ],
            'formidable' => [
                'label' => 'Formidable Forms (Address field)',
                'help' => 'The Address field of Formidable Forms.',
                'pages' => ['mode' => 'all', 'ids' => [], 'paths' => [], 'account_address' => false],
                'groups' => [['label' => 'Address field', 'fields' => [
                    'address' => '.frm_form_field input[name$="[line1]"]',
                    'address2' => '.frm_form_field input[name$="[line2]"]',
                    'city' => '.frm_form_field input[name$="[city]"]',
                    'state' => '.frm_form_field [name$="[state]"]',
                    'postcode' => '.frm_form_field input[name$="[zip]"]',
                    'country' => '.frm_form_field select[name$="[country]"]',
                ]]],
            ],
            'custom' => [
                'label' => 'Another form (pick the fields with the Visual Selector Tool)',
                'help' => 'Any HTML form: click each field on your own page and the tool writes the selector for you.',
                'pages' => ['mode' => 'selected', 'ids' => [], 'paths' => [], 'account_address' => false],
                'groups' => [['label' => 'Form', 'fields' => array_fill_keys(self::FIELDS, '')]],
            ],
        ];
    }

    /** @return array<string, string> */
    private static function wooBlock(string $type): array
    {
        return [
            'address' => "#{$type}-address_1",
            'address2' => "#{$type}-address_2",
            'city' => "#{$type}-city",
            'state' => "#{$type}-state",
            'postcode' => "#{$type}-postcode",
            'country' => "#{$type}-country",
        ];
    }

    /** @return array<string, string> */
    private static function wooClassic(string $type): array
    {
        return [
            'address' => "#{$type}_address_1",
            'address2' => "#{$type}_address_2",
            'city' => "#{$type}_city",
            'state' => "#{$type}_state",
            'postcode' => "#{$type}_postcode",
            'country' => "#{$type}_country",
        ];
    }
}
