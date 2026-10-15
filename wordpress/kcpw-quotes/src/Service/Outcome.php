<?php
declare(strict_types=1);

namespace KcPrintworks\Quotes\Service;

/** What an action did: ok or not, a short machine code, a sentence for the person using the dashboard, and optional data. */
final class Outcome
{
    /** @param array<string,mixed> $data */
    private function __construct(
        public readonly bool $ok,
        public readonly string $code,
        public readonly string $message,
        public readonly array $data = [],
    ) {
    }

    /** @param array<string,mixed> $data */
    public static function ok(string $code = 'ok', string $message = '', array $data = []): self
    {
        return new self(true, $code, $message, $data);
    }

    /** @param array<string,mixed> $data */
    public static function fail(string $code, string $message, array $data = []): self
    {
        return new self(false, $code, $message, $data);
    }
}
