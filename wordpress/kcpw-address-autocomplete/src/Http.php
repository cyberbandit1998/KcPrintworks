<?php
declare(strict_types=1);

namespace KcPrintworks\AddressAutocomplete;

/** The one way this plugin talks to another server, so tests can answer for it and nothing else can call out by accident. */
interface Http
{
    /**
     * @param array<string, string> $headers
     * @return array{status: int, body: string}|null null when the request could not be made at all
     */
    public function post(string $url, array $headers, string $body, int $timeout, bool $blocking = true): ?array;

    /**
     * @param array<string, string> $headers
     * @return array{status: int, body: string}|null
     */
    public function get(string $url, array $headers, int $timeout): ?array;
}
