<?php
declare(strict_types=1);

namespace KcPrintworks\Core\Handoff;

use KcPrintworks\Core\Cart\LineIntent;
use KcPrintworks\Core\Cart\RequestError;
use KcPrintworks\Core\Support\Json;

/**
 * The body of POST /cart/quote and /cart/handoff:  {"lines":[...], "expectedSubtotal": 1798 }.
 * Strict: any other field (a price, a total, a discount) rejects the request. `expectedSubtotal` is what the storefront
 * SERVER believed the cart cost; it is only compared with the authoritative figure, never used to price anything.
 */
final class HandoffRequest
{
    public const MAX_LINES = 50;
    public const MAX_BODY_BYTES = 64_000;

    /** @param list<LineIntent> $lines */
    private function __construct(public readonly array $lines, public readonly ?int $expectedSubtotal)
    {
    }

    /** @throws RequestError */
    public static function parse(string $body): self
    {
        if (strlen($body) > self::MAX_BODY_BYTES) {
            throw new RequestError(['The request is too large.']);
        }
        try {
            $data = Json::decode($body);
        } catch (\JsonException $e) {
            throw new RequestError(['The request is not valid JSON.']);
        }
        if (!($data instanceof \stdClass)) {
            throw new RequestError(['The request must be a JSON object.']);
        }
        $problems = [];
        foreach (array_keys(get_object_vars($data)) as $key) {
            if (!in_array((string) $key, ['lines', 'expectedSubtotal'], true)) {
                $problems[] = "Unexpected field \"$key\". Prices and totals are never accepted from a request.";
            }
        }
        $raw = $data->lines ?? null;
        if (!is_array($raw) || $raw === [] || count($raw) > self::MAX_LINES) {
            $problems[] = 'lines must be a list of 1 to ' . self::MAX_LINES . ' items.';
        }
        $expected = $data->expectedSubtotal ?? null;
        if ($expected !== null && (!is_int($expected) || $expected < 0)) {
            $problems[] = 'expectedSubtotal must be a whole number of cents.';
        }
        $lines = [];
        if (is_array($raw)) {
            foreach ($raw as $index => $line) {
                try {
                    $lines[] = LineIntent::parse($line, (int) $index);
                } catch (RequestError $e) {
                    array_push($problems, ...$e->problems);
                }
            }
        }
        if ($problems !== []) {
            throw new RequestError($problems);
        }
        return new self($lines, $expected);
    }
}
