<?php
declare(strict_types=1);

namespace KcPrintworks\Quotes\Domain;

/**
 * Validation of a customer's approval (the shipping address and the "yes"), identical to validateQuoteApproval in
 * packages/contracts/src/quote-logic.ts and proven by the shared vectors. There is no price and no quote number in it: the plugin looks
 * those up from the secret link. Pure PHP (no WordPress calls).
 */
final class ApprovalInput
{
    public const ADDRESS_LINE_MIN = 3;
    public const ADDRESS_LINE_MAX = 100;
    public const CITY_MIN = 2;
    public const CITY_MAX = 60;
    public const STATE_MAX = 60;

    private const FIELDS = ['revision', 'line1', 'line2', 'city', 'state', 'postcode', 'country', 'phone', 'accepted'];
    private const POSTCODE = '/^[A-Za-z0-9][A-Za-z0-9 -]{1,10}[A-Za-z0-9]$/D';
    private const PHONE = '/^[0-9+()\-. ]{5,30}$/D';

    public static function validate(mixed $input): QuoteValidation
    {
        if (!($input instanceof \stdClass)) {
            return new QuoteValidation(false, null, [Text::issue('', 'invalid_type', 'The approval is not in the expected form.')]);
        }
        $data = get_object_vars($input);
        $issues = [];
        foreach (array_keys($data) as $key) {
            if (!in_array((string) $key, self::FIELDS, true)) {
                $issues[] = Text::issue((string) $key, 'unknown_field', 'Unknown field "' . $key . '".');
            }
        }

        $revision = Text::wholeNumber($data['revision'] ?? null);
        if ($revision === null || $revision < 0 || $revision > 100000) {
            $issues[] = Text::issue('revision', 'invalid_type', 'This page is out of date. Please reload it.');
        }

        $line1 = self::text($data, 'line1', 'your street address', self::ADDRESS_LINE_MIN, self::ADDRESS_LINE_MAX, true, $issues);
        $line2 = self::text($data, 'line2', 'the apartment or suite', 1, self::ADDRESS_LINE_MAX, false, $issues);
        $city = self::text($data, 'city', 'your city', self::CITY_MIN, self::CITY_MAX, true, $issues);
        $state = self::text($data, 'state', 'your state or region', 1, self::STATE_MAX, false, $issues);

        $postcode = '';
        $raw = $data['postcode'] ?? null;
        if (Text::missing($raw)) {
            $issues[] = Text::issue('postcode', 'required', 'Enter your ZIP or postal code.');
        } elseif (!is_string($raw)) {
            $issues[] = Text::issue('postcode', 'invalid_type', 'Enter your ZIP or postal code.');
        } else {
            $normalized = Text::normalize($raw);
            $postcode = $normalized === null ? '' : Text::collapse($normalized);
            if ($normalized === null || preg_match(self::POSTCODE, $postcode) !== 1) {
                $issues[] = Text::issue('postcode', 'invalid_characters', 'Enter a valid ZIP or postal code.');
                $postcode = '';
            }
        }

        $country = '';
        $raw = $data['country'] ?? null;
        if (Text::missing($raw)) {
            $issues[] = Text::issue('country', 'required', 'Choose your country.');
        } elseif (!is_string($raw) || preg_match('/^[A-Za-z]{2}$/D', Text::trim($raw)) !== 1) {
            $issues[] = Text::issue('country', 'invalid_choice', 'Choose your country from the list.');
        } else {
            $country = strtoupper(Text::trim($raw));
        }

        $phone = '';
        $raw = $data['phone'] ?? null;
        if (!Text::missing($raw)) {
            if (!is_string($raw) || preg_match(self::PHONE, Text::trim($raw)) !== 1) {
                $issues[] = Text::issue('phone', 'invalid_characters', 'Enter a phone number with digits, spaces and + ( ) - only.');
            } else {
                $phone = Text::trim($raw);
            }
        }

        if (($data['accepted'] ?? null) !== true) {
            $issues[] = Text::issue('accepted', 'terms_required', 'Please confirm that you approve this quote.');
        }

        if ($issues !== []) {
            return new QuoteValidation(false, null, $issues);
        }
        return new QuoteValidation(true, [
            'revision' => (int) $revision,
            'line1' => $line1,
            'line2' => $line2,
            'city' => $city,
            'state' => $state,
            'postcode' => $postcode,
            'country' => $country,
            'phone' => $phone,
            'accepted' => true,
        ], []);
    }

    /**
     * @param array<string,mixed> $data
     * @param list<array{field:string,code:string,message:string}> $issues
     */
    private static function text(array $data, string $field, string $label, int $min, int $max, bool $required, array &$issues): string
    {
        $raw = $data[$field] ?? null;
        $cap = ucfirst($label);
        if (Text::missing($raw)) {
            if ($required) {
                $issues[] = Text::issue($field, 'required', 'Enter ' . $label . '.');
            }
            return '';
        }
        if (!is_string($raw)) {
            $issues[] = Text::issue($field, 'invalid_type', 'Enter ' . $label . '.');
            return '';
        }
        $normalized = Text::normalize($raw);
        if ($normalized === null) {
            $issues[] = Text::issue($field, 'invalid_characters', $cap . ' contains characters that cannot be saved.');
            return '';
        }
        $value = Text::collapse($normalized);
        if ($value === '') {
            if ($required) {
                $issues[] = Text::issue($field, 'required', 'Enter ' . $label . '.');
            }
            return '';
        }
        if (Text::forbidden($value, false)) {
            $issues[] = Text::issue($field, 'invalid_characters', $cap . ' contains characters that cannot be saved.');
            return '';
        }
        if (Text::length($value) < $min) {
            $issues[] = Text::issue($field, 'too_short', $cap . ' is too short.');
        } elseif (Text::length($value) > $max) {
            $issues[] = Text::issue($field, 'too_long', $cap . ' is too long.');
        }
        return $value;
    }
}
