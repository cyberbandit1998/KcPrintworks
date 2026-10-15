<?php
declare(strict_types=1);

namespace KcPrintworks\Quotes\Domain;

/**
 * Validation of a custom quote request, identical to validateQuoteRequest in packages/contracts/src/quote-logic.ts (the TypeScript
 * reference). packages/contracts/test/vectors/quotes.json proves they agree: same verdict, same cleaned values, same (field, code) issues
 * in the same order.
 *
 * A request can say who is asking, what they want made, how many and when. It can never say what it costs, what status it has, or which
 * order it belongs to: any such field is refused as unknown. Pure PHP (no WordPress calls).
 */
final class QuoteInput
{
    public const NAME_MIN = 2;
    public const NAME_MAX = 80;
    public const EMAIL_MAX = 120;
    public const GAME_MAX = 120;
    public const DESCRIPTION_MIN = 20;
    public const DESCRIPTION_MAX = 4000;
    public const DIMENSIONS_MAX = 200;
    public const COLORS_MAX = 200;
    public const SHIP_TO_MAX = 120;
    public const QUANTITY_MIN = 1;
    public const QUANTITY_MAX = 1000;
    public const LINKS_IN_DESCRIPTION_MAX = 2;

    public const PROJECT_TYPES = [
        'game-case' => 'Game case or box',
        'organizer-insert' => 'Organizer or insert',
        'personalized-gift' => 'Personalized gift',
        'replacement-part' => 'Replacement or repair part',
        'display-sign' => 'Display or sign',
        'prototype' => 'Prototype or one-off',
        'other' => 'Something else',
    ];

    private const FIELDS = ['name', 'email', 'projectType', 'game', 'description', 'dimensions', 'quantity', 'colors', 'deadline', 'shipTo'];

    private const NAME_CHARACTERS = '/^[\p{L}\p{M}\p{N} .\'\x{2019}-]+$/uD';
    private const EMAIL = '/^[a-z0-9](?:[a-z0-9._%+-]{0,62}[a-z0-9])?@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/D';
    /** Deliberately without the /u flag: JavaScript's \b and /i are ASCII-only there, and so must they be here. */
    private const LINK = '/https?:\/\/|\bwww\.|\b[a-z0-9-]+\.(?:com|net|org|io|co|ru|xyz|top|shop|site|info|biz|click|link)\b/i';

    /** @param mixed $input the decoded JSON object (stdClass). Anything else is rejected as a whole. */
    public static function validate(mixed $input): QuoteValidation
    {
        if (!($input instanceof \stdClass)) {
            return new QuoteValidation(false, null, [Text::issue('', 'invalid_type', 'The request is not in the expected form.')]);
        }
        $data = get_object_vars($input);
        $issues = [];
        foreach (array_keys($data) as $key) {
            if (!in_array((string) $key, self::FIELDS, true)) {
                $issues[] = Text::issue((string) $key, 'unknown_field', 'Unknown field "' . $key . '".');
            }
        }

        // name
        $name = '';
        $raw = $data['name'] ?? null;
        if (Text::missing($raw)) {
            $issues[] = Text::issue('name', 'required', 'Enter your name.');
        } elseif (!is_string($raw)) {
            $issues[] = Text::issue('name', 'invalid_type', 'Enter your name.');
        } else {
            $normalized = Text::normalize($raw);
            if ($normalized === null) {
                $issues[] = Text::issue('name', 'invalid_characters', "Use only letters, numbers, spaces, and . ' - in your name.");
            } else {
                $name = Text::collapse($normalized);
                if ($name === '') {
                    $issues[] = Text::issue('name', 'required', 'Enter your name.');
                } elseif (Text::forbidden($name, false) || preg_match(self::NAME_CHARACTERS, $name) !== 1 || preg_match('/\p{L}/u', $name) !== 1) {
                    $issues[] = Text::issue('name', 'invalid_characters', "Use only letters, numbers, spaces, and . ' - in your name.");
                } elseif (Text::length($name) < self::NAME_MIN) {
                    $issues[] = Text::issue('name', 'too_short', 'Your name must be at least ' . self::NAME_MIN . ' characters.');
                } elseif (Text::length($name) > self::NAME_MAX) {
                    $issues[] = Text::issue('name', 'too_long', 'Your name must be at most ' . self::NAME_MAX . ' characters.');
                }
            }
        }

        // email (ASCII only; lower-cased the same way everywhere)
        $email = '';
        $raw = $data['email'] ?? null;
        if (Text::missing($raw)) {
            $issues[] = Text::issue('email', 'required', 'Enter your email address.');
        } elseif (!is_string($raw)) {
            $issues[] = Text::issue('email', 'invalid_type', 'Enter your email address.');
        } else {
            $normalized = Text::normalize($raw);
            $email = $normalized === null ? '' : strtr($normalized, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz');
            if ($normalized === null) {
                $issues[] = Text::issue('email', 'invalid_email', 'Enter a valid email address, like name@example.com.');
            } elseif ($email === '') {
                $issues[] = Text::issue('email', 'required', 'Enter your email address.');
            } elseif (Text::length($email) > self::EMAIL_MAX) {
                $issues[] = Text::issue('email', 'too_long', 'Your email address must be at most ' . self::EMAIL_MAX . ' characters.');
            } elseif (preg_match(self::EMAIL, $email) !== 1 || str_contains($email, '..')) {
                $issues[] = Text::issue('email', 'invalid_email', 'Enter a valid email address, like name@example.com.');
            }
        }

        // project type
        $projectType = '';
        $raw = $data['projectType'] ?? null;
        if (Text::missing($raw)) {
            $issues[] = Text::issue('projectType', 'required', 'Choose the kind of project.');
        } elseif (!is_string($raw) || !isset(self::PROJECT_TYPES[$raw])) {
            $issues[] = Text::issue('projectType', 'invalid_choice', 'Choose the kind of project from the list.');
        } else {
            $projectType = $raw;
        }

        // game / theme, dimensions, colors, shipTo: optional short text
        $game = self::singleLine($data, 'game', self::GAME_MAX, 'The game or theme', $issues);
        $dimensions = self::singleLine($data, 'dimensions', self::DIMENSIONS_MAX, 'The dimensions', $issues);
        $colors = self::singleLine($data, 'colors', self::COLORS_MAX, 'The colors', $issues);
        $shipTo = self::singleLine($data, 'shipTo', self::SHIP_TO_MAX, 'Where it ships', $issues);

        // description
        $description = '';
        $raw = $data['description'] ?? null;
        if (Text::missing($raw)) {
            $issues[] = Text::issue('description', 'required', 'Tell us what you would like made.');
        } elseif (!is_string($raw)) {
            $issues[] = Text::issue('description', 'invalid_type', 'Tell us what you would like made.');
        } else {
            $normalized = Text::normalize($raw);
            if ($normalized === null) {
                $issues[] = Text::issue('description', 'invalid_characters', 'Your description contains characters that cannot be saved.');
            } else {
                $description = (string) preg_replace('/\n{3,}/', "\n\n", $normalized);
                if ($description === '') {
                    $issues[] = Text::issue('description', 'required', 'Tell us what you would like made.');
                } elseif (Text::forbidden($description, true)) {
                    $issues[] = Text::issue('description', 'invalid_characters', 'Your description contains characters that cannot be saved.');
                } elseif (Text::length($description) < self::DESCRIPTION_MIN) {
                    $issues[] = Text::issue('description', 'too_short', 'Please write at least ' . self::DESCRIPTION_MIN . ' characters so we can quote it.');
                } elseif (Text::length($description) > self::DESCRIPTION_MAX) {
                    $issues[] = Text::issue('description', 'too_long', 'Your description must be at most ' . self::DESCRIPTION_MAX . ' characters.');
                } elseif ((int) preg_match_all(self::LINK, $description) > self::LINKS_IN_DESCRIPTION_MAX) {
                    $issues[] = Text::issue('description', 'too_many_links', 'Please include at most ' . self::LINKS_IN_DESCRIPTION_MAX . ' web addresses.');
                }
            }
        }

        // quantity (a whole number, sent as a number)
        $quantity = $data['quantity'] ?? null;
        if (Text::missing($quantity)) {
            $issues[] = Text::issue('quantity', 'required', 'Enter how many you need.');
        } else {
            $quantity = Text::wholeNumber($quantity);
            if ($quantity === null || $quantity < self::QUANTITY_MIN || $quantity > self::QUANTITY_MAX) {
                $issues[] = Text::issue('quantity', 'invalid_quantity', 'Enter a whole number from ' . self::QUANTITY_MIN . ' to ' . self::QUANTITY_MAX . '.');
            }
        }

        // deadline (optional; a real calendar date)
        $deadline = '';
        $raw = $data['deadline'] ?? null;
        if (!Text::missing($raw)) {
            if (!is_string($raw)) {
                $issues[] = Text::issue('deadline', 'invalid_type', 'Choose a date.');
            } else {
                $deadline = Text::trim($raw);
                if (!self::isCalendarDate($deadline)) {
                    $issues[] = Text::issue('deadline', 'invalid_date', 'Enter a real date, like 2026-12-24.');
                    $deadline = '';
                }
            }
        }

        if ($issues !== []) {
            return new QuoteValidation(false, null, $issues);
        }
        return new QuoteValidation(true, [
            'name' => $name,
            'email' => $email,
            'projectType' => $projectType,
            'game' => $game,
            'description' => $description,
            'dimensions' => $dimensions,
            'quantity' => (int) $quantity,
            'colors' => $colors,
            'deadline' => $deadline,
            'shipTo' => $shipTo,
        ], []);
    }

    /** Is `$text` a real calendar date written YYYY-MM-DD? (2026-02-30 is not.) */
    public static function isCalendarDate(string $text): bool
    {
        if (preg_match('/^(\d{4})-(\d{2})-(\d{2})$/D', $text, $m) !== 1) {
            return false;
        }
        [$year, $month, $day] = [(int) $m[1], (int) $m[2], (int) $m[3]];
        if ($year < 1900 || $year > 2200 || $month < 1 || $month > 12 || $day < 1) {
            return false;
        }
        $leap = $year % 4 === 0 && ($year % 100 !== 0 || $year % 400 === 0);
        $last = [31, $leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][$month - 1];
        return $day <= $last;
    }

    /** A deadline must not be in the past and not more than two years away. `$today` is YYYY-MM-DD in the shop's time zone. */
    public static function deadlineProblem(string $deadline, string $today): ?string
    {
        if ($deadline === '') {
            return null;
        }
        if (strcmp($deadline, $today) < 0) {
            return 'past';
        }
        [$y, $mo, $d] = array_map('intval', explode('-', $today));
        $limit = sprintf('%04d-%02d-%02d', $y + 2, $mo, $d);
        return strcmp($deadline, $limit) > 0 ? 'too_far' : null;
    }

    /**
     * @param array<string,mixed> $data
     * @param list<array{field:string,code:string,message:string}> $issues
     */
    private static function singleLine(array $data, string $field, int $max, string $label, array &$issues): string
    {
        $raw = $data[$field] ?? null;
        if (Text::missing($raw)) {
            return '';
        }
        if (!is_string($raw)) {
            $issues[] = Text::issue($field, 'invalid_type', $label . ' is not valid.');
            return '';
        }
        $normalized = Text::normalize($raw);
        if ($normalized === null) {
            $issues[] = Text::issue($field, 'invalid_characters', $label . ' contains characters that cannot be saved.');
            return '';
        }
        $text = Text::collapse($normalized);
        if ($text === '') {
            return '';
        }
        if (Text::forbidden($text, false)) {
            $issues[] = Text::issue($field, 'invalid_characters', $label . ' contains characters that cannot be saved.');
            return '';
        }
        if (Text::length($text) > $max) {
            $issues[] = Text::issue($field, 'too_long', $label . ' must be at most ' . $max . ' characters.');
            return '';
        }
        if (preg_match(self::LINK, $text) === 1) {
            $issues[] = Text::issue($field, 'links_not_allowed', 'Please leave web addresses out of ' . strtolower($label) . '.');
            return '';
        }
        return $text;
    }
}
