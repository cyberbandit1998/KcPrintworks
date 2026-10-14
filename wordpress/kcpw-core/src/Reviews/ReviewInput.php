<?php
declare(strict_types=1);

namespace KcPrintworks\Core\Reviews;

/**
 * Validation of a customer review, identical to packages/contracts/src/review-logic.ts (the TypeScript reference). The shared vectors in
 * packages/contracts/test/vectors/reviews.json prove they agree: same verdict, same normalized values, same (field, code) issues in the
 * same order.
 *
 * A submission can say which product, a rating, a display name, an email address, and the text. It can never say whether it is
 * approved or verified or where it came from: any such field is refused as unknown. Pure PHP (no WordPress calls).
 */
final class ReviewInput
{
    public const NAME_MIN = 2;
    public const NAME_MAX = 60;
    public const EMAIL_MAX = 120;
    public const TEXT_MIN = 10;
    public const TEXT_MAX = 2000;

    private const FIELDS = ['productId', 'rating', 'name', 'email', 'review'];

    /** Control, zero-width, and bidi characters (written as escapes, never literally). Newline is handled separately. */
    private const FORBIDDEN = '/[\x{0000}-\x{0009}\x{000B}-\x{001F}\x{007F}-\x{009F}\x{200B}-\x{200F}\x{202A}-\x{202E}\x{2066}-\x{2069}\x{FEFF}]/u';

    /** What JavaScript's trim() removes, and the same set used to collapse runs of spaces in a name. */
    private const SPACE = '[\x{0009}-\x{000D}\x{0020}\x{00A0}\x{1680}\x{2000}-\x{200A}\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}\x{FEFF}]';

    private const NAME_CHARACTERS = '/^[\p{L}\p{M}\p{N} .\'\x{2019}-]+$/uD';
    private const EMAIL = '/^[a-z0-9](?:[a-z0-9._%+-]{0,62}[a-z0-9])?@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/D';
    /** Deliberately without the /u flag: JavaScript's \b and /i are ASCII-only there, and so must they be here. */
    private const LINK = '/https?:\/\/|\bwww\.|\b[a-z0-9-]+\.(?:com|net|org|io|co|ru|xyz|top|shop|site|info|biz|click|link)\b/i';

    /** @param mixed $input the decoded JSON object (stdClass). Anything else is rejected as a whole. */
    public static function validate(mixed $input): ReviewValidation
    {
        if (!($input instanceof \stdClass)) {
            return new ReviewValidation(false, null, [self::issue('', 'invalid_type', 'The review is not in the expected form.')]);
        }
        $data = get_object_vars($input);
        $issues = [];
        foreach (array_keys($data) as $key) {
            if (!in_array((string) $key, self::FIELDS, true)) {
                $issues[] = self::issue((string) $key, 'unknown_field', 'Unknown field "' . $key . '".');
            }
        }

        $productId = $data['productId'] ?? null;
        if (self::missing($productId)) {
            $issues[] = self::issue('productId', 'required', 'The product is missing.');
        } else {
            $productId = self::wholeNumber($productId);
            if ($productId === null || $productId < 1 || $productId > 2147483647) {
                $issues[] = self::issue('productId', 'invalid_product', 'This product cannot be reviewed.');
            }
        }

        $rating = $data['rating'] ?? null;
        if (self::missing($rating)) {
            $issues[] = self::issue('rating', 'required', 'Choose a rating from 1 to 5 stars.');
        } else {
            $rating = self::wholeNumber($rating);
            if ($rating === null || $rating < 1 || $rating > 5) {
                $issues[] = self::issue('rating', 'invalid_rating', 'Choose a rating from 1 to 5 stars.');
            }
        }

        $name = '';
        $rawName = $data['name'] ?? null;
        if (self::missing($rawName)) {
            $issues[] = self::issue('name', 'required', 'Enter your name.');
        } elseif (!is_string($rawName)) {
            $issues[] = self::issue('name', 'invalid_type', 'Enter your name.');
        } else {
            $normalized = self::normalize($rawName);
            if ($normalized === null) {
                $issues[] = self::issue('name', 'invalid_characters', 'Use only letters, numbers, spaces, and . \' - in your name.');
            } else {
                $name = (string) preg_replace('/' . self::SPACE . '+/u', ' ', $normalized);
                if ($name === '') {
                    $issues[] = self::issue('name', 'required', 'Enter your name.');
                } elseif (self::forbidden($name, false) || preg_match(self::NAME_CHARACTERS, $name) !== 1 || preg_match('/\p{L}/u', $name) !== 1) {
                    $issues[] = self::issue('name', 'invalid_characters', 'Use only letters, numbers, spaces, and . \' - in your name.');
                } elseif (mb_strlen($name, 'UTF-8') < self::NAME_MIN) {
                    $issues[] = self::issue('name', 'too_short', 'Your name must be at least ' . self::NAME_MIN . ' characters.');
                } elseif (mb_strlen($name, 'UTF-8') > self::NAME_MAX) {
                    $issues[] = self::issue('name', 'too_long', 'Your name must be at most ' . self::NAME_MAX . ' characters.');
                }
            }
        }

        $email = '';
        $rawEmail = $data['email'] ?? null;
        if (self::missing($rawEmail)) {
            $issues[] = self::issue('email', 'required', 'Enter your email address.');
        } elseif (!is_string($rawEmail)) {
            $issues[] = self::issue('email', 'invalid_type', 'Enter your email address.');
        } else {
            $normalized = self::normalize($rawEmail);
            $email = $normalized === null ? '' : strtr($normalized, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz');
            if ($normalized === null) {
                $issues[] = self::issue('email', 'invalid_email', 'Enter a valid email address, like name@example.com.');
            } elseif ($email === '') {
                $issues[] = self::issue('email', 'required', 'Enter your email address.');
            } elseif (mb_strlen($email, 'UTF-8') > self::EMAIL_MAX) {
                $issues[] = self::issue('email', 'too_long', 'Your email address must be at most ' . self::EMAIL_MAX . ' characters.');
            } elseif (preg_match(self::EMAIL, $email) !== 1 || str_contains($email, '..')) {
                $issues[] = self::issue('email', 'invalid_email', 'Enter a valid email address, like name@example.com.');
            }
        }

        $review = '';
        $rawReview = $data['review'] ?? null;
        if (self::missing($rawReview)) {
            $issues[] = self::issue('review', 'required', 'Write your review.');
        } elseif (!is_string($rawReview)) {
            $issues[] = self::issue('review', 'invalid_type', 'Write your review.');
        } else {
            $normalized = self::normalize($rawReview);
            if ($normalized === null) {
                $issues[] = self::issue('review', 'invalid_characters', 'Your review contains characters that cannot be saved.');
            } else {
                $review = (string) preg_replace('/\n{3,}/', "\n\n", $normalized);
                if ($review === '') {
                    $issues[] = self::issue('review', 'required', 'Write your review.');
                } elseif (self::forbidden($review, true)) {
                    $issues[] = self::issue('review', 'invalid_characters', 'Your review contains characters that cannot be saved.');
                } elseif (mb_strlen($review, 'UTF-8') < self::TEXT_MIN) {
                    $issues[] = self::issue('review', 'too_short', 'Your review must be at least ' . self::TEXT_MIN . ' characters.');
                } elseif (mb_strlen($review, 'UTF-8') > self::TEXT_MAX) {
                    $issues[] = self::issue('review', 'too_long', 'Your review must be at most ' . self::TEXT_MAX . ' characters.');
                } elseif (preg_match(self::LINK, $review) === 1) {
                    $issues[] = self::issue('review', 'links_not_allowed', 'Please leave web addresses and email addresses out of your review.');
                }
            }
        }

        if ($issues !== []) {
            return new ReviewValidation(false, null, $issues);
        }
        return new ReviewValidation(true, [
            'productId' => (int) $productId,
            'rating' => (int) $rating,
            'name' => $name,
            'email' => $email,
            'review' => $review,
        ], []);
    }

    private static function missing(mixed $value): bool
    {
        return $value === null || $value === '';
    }

    /** JSON numbers: 5 and 5.0 are the same whole number (as in JavaScript); text, booleans, and fractions are not numbers here. */
    private static function wholeNumber(mixed $value): ?int
    {
        if (is_int($value)) {
            return $value;
        }
        if (is_float($value) && is_finite($value) && floor($value) === $value && abs($value) < 9.0e15) {
            return (int) $value;
        }
        return null;
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
        $trimmed = preg_replace('/^' . self::SPACE . '+|' . self::SPACE . '+$/u', '', $raw);
        return $trimmed;
    }

    private static function forbidden(string $text, bool $allowNewline): bool
    {
        if (!$allowNewline && str_contains($text, "\n")) {
            return true;
        }
        return preg_match(self::FORBIDDEN, $text) === 1;
    }

    /** @return array{field:string,code:string,message:string} */
    private static function issue(string $field, string $code, string $message): array
    {
        return ['field' => $field, 'code' => $code, 'message' => $message];
    }
}
