<?php
declare(strict_types=1);

namespace KcPrintworks\AddressAutocomplete\Tests;

use KcPrintworks\AddressAutocomplete\Http;

/** Answers for the network and writes down every call, so a test can say what was (and was not) sent where. */
final class FakeHttp implements Http
{
    /** @var list<array{method: string, url: string, headers: array<string, string>, body: string, blocking: bool}> */
    public array $calls = [];

    /** @param array{status: int, body: string}|null $answer */
    public function __construct(public ?array $answer = ['status' => 200, 'body' => '{}'])
    {
    }

    public function post(string $url, array $headers, string $body, int $timeout, bool $blocking = true): ?array
    {
        $this->calls[] = ['method' => 'POST', 'url' => $url, 'headers' => $headers, 'body' => $body, 'blocking' => $blocking];
        return $this->answer;
    }

    public function get(string $url, array $headers, int $timeout): ?array
    {
        $this->calls[] = ['method' => 'GET', 'url' => $url, 'headers' => $headers, 'body' => '', 'blocking' => true];
        return $this->answer;
    }
}
