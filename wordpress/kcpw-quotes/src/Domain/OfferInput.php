<?php
declare(strict_types=1);

namespace KcPrintworks\Quotes\Domain;

/**
 * The owner's offer, from the quote form in the dashboard: what is offered, the item price, the shipping price and how long the offer
 * stands. Prices are typed as decimal text ("45", "45.00", "$1,250.50") and become whole cents here, with no floating point anywhere.
 */
final class OfferInput
{
    public const TITLE_MIN = 3;
    public const TITLE_MAX = 120;
    public const DETAILS_MAX = 4000;
    /** Stripe cannot take less than 50 cents, so a quote below that could never be paid. */
    public const MIN_TOTAL_CENTS = 50;
    public const MAX_TOTAL_CENTS = 5_000_000;
    public const MAX_VALID_DAYS = 90;

    /**
     * @param array<string,mixed> $input title, details, item_price, shipping_price, expires (YYYY-MM-DD in the shop's time zone, or empty for the default)
     */
    public static function validate(array $input, int $now, \DateTimeZone $zone, int $defaultDays): QuoteValidation
    {
        $issues = [];
        $field = static fn (string $name): string => is_string($input[$name] ?? null) ? $input[$name] : '';

        $title = Text::collapse(Text::normalize($field('title')) ?? '');
        if ($title === '') {
            $issues[] = Text::issue('title', 'required', 'Say what you are offering, for example "Custom case for Catan, two-tone".');
        } elseif (Text::forbidden($title, false)) {
            $issues[] = Text::issue('title', 'invalid_characters', 'The title contains characters that cannot be saved.');
        } elseif (Text::length($title) < self::TITLE_MIN) {
            $issues[] = Text::issue('title', 'too_short', 'The title is too short.');
        } elseif (Text::length($title) > self::TITLE_MAX) {
            $issues[] = Text::issue('title', 'too_long', 'The title can be at most ' . self::TITLE_MAX . ' characters.');
        }

        $detailsRaw = Text::normalize($field('details'));
        $details = $detailsRaw === null ? '' : (string) preg_replace('/\n{3,}/', "\n\n", $detailsRaw);
        if ($detailsRaw === null || Text::forbidden($details, true)) {
            $issues[] = Text::issue('details', 'invalid_characters', 'The details contain characters that cannot be saved.');
        } elseif (Text::length($details) > self::DETAILS_MAX) {
            $issues[] = Text::issue('details', 'too_long', 'The details can be at most ' . self::DETAILS_MAX . ' characters.');
        }

        $item = self::price($field('item_price'));
        if ($item === null || $item < 1) {
            $issues[] = Text::issue('item_price', 'invalid_price', 'Enter the item price as a number, for example 45.00.');
            $item = 0;
        }
        $shipping = trim($field('shipping_price')) === '' ? 0 : self::price($field('shipping_price'));
        if ($shipping === null) {
            $issues[] = Text::issue('shipping_price', 'invalid_price', 'Enter the shipping price as a number, for example 8.50 (or leave it empty for free shipping).');
            $shipping = 0;
        }
        $total = $item + $shipping;
        if ($item > 0 && $total < self::MIN_TOTAL_CENTS) {
            $issues[] = Text::issue('item_price', 'too_small', 'The total must be at least $0.50: card payments cannot be smaller.');
        } elseif ($total > self::MAX_TOTAL_CENTS) {
            $issues[] = Text::issue('item_price', 'too_large', 'The total cannot be more than $50,000.00. For larger jobs, arrange payment another way.');
        }

        $expiresAt = 0;
        $expires = trim($field('expires'));
        if ($expires === '') {
            $expiresAt = self::endOfDay((new \DateTimeImmutable('@' . $now))->setTimezone($zone)->modify('+' . $defaultDays . ' days')->format('Y-m-d'), $zone) ?? 0;
        } elseif (!QuoteInput::isCalendarDate($expires)) {
            $issues[] = Text::issue('expires', 'invalid_date', 'Enter a real date, like 2026-12-24.');
        } else {
            $end = self::endOfDay($expires, $zone);
            if ($end === null || $end <= $now) {
                $issues[] = Text::issue('expires', 'in_the_past', 'The offer must stand until a day that has not passed yet.');
            } elseif ($end > $now + (self::MAX_VALID_DAYS + 1) * 86400) {
                $issues[] = Text::issue('expires', 'too_far', 'An offer can stand for at most ' . self::MAX_VALID_DAYS . ' days.');
            } else {
                $expiresAt = $end;
            }
        }

        if ($issues !== []) {
            return new QuoteValidation(false, null, $issues);
        }
        return new QuoteValidation(true, [
            'title' => $title,
            'details' => $details,
            'itemCents' => $item,
            'shipCents' => (int) $shipping,
            'expiresAt' => $expiresAt,
        ], []);
    }

    /** "1,250.5" and "$45" and "45.00" -> cents. Null when it is not a plain amount. */
    public static function price(string $text): ?int
    {
        $text = preg_replace('/^\$|[\s,]/', '', $text) ?? '';
        if (preg_match('/^\d{1,7}(?:\.\d{1,2})?$/D', $text) !== 1) {
            return null;
        }
        return \KcPrintworks\Quotes\Support\Money::parse($text, 2);
    }

    /** The last second of a calendar day (YYYY-MM-DD) in the shop's time zone, as unix seconds. */
    public static function endOfDay(string $date, \DateTimeZone $zone): ?int
    {
        $day = \DateTimeImmutable::createFromFormat('!Y-m-d', $date, $zone);
        if ($day === false) {
            return null;
        }
        return $day->setTime(23, 59, 59)->getTimestamp();
    }
}
