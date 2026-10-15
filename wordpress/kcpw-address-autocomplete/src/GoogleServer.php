<?php
declare(strict_types=1);

namespace KcPrintworks\AddressAutocomplete;

/**
 * The server-side call to Google's Address Validation API, with the SERVER key (never the browser key: a browser key is restricted to
 * websites and would be refused here). The key goes in a header, not the address, so it never lands in an access log.
 *
 * What it returns is a verdict and a reason code, never Google's raw answer, so a page can show it without knowing anything else.
 */
final class GoogleServer
{
    public const VALIDATE_URL = 'https://addressvalidation.googleapis.com/v1:validateAddress';
    public const TIMEOUT = 4;

    public function __construct(private readonly Http $http, private readonly string $key)
    {
    }

    /**
     * @param array{regionCode: string, postalCode: string, administrativeArea: string, locality: string, addressLines: list<string>} $address
     * @return array{verdict: string, reason: string}
     */
    public function validate(array $address): array
    {
        $response = $this->http->post(
            self::VALIDATE_URL,
            ['Content-Type' => 'application/json', 'X-Goog-Api-Key' => $this->key],
            (string) json_encode(Validation::buildRequest($address)),
            self::TIMEOUT,
        );
        if ($response === null) {
            return ['verdict' => Validation::UNKNOWN, 'reason' => 'network'];
        }
        if ($response['status'] === 200) {
            $data = json_decode($response['body'], true);
            return is_array($data) ? Validation::verdict($data) : ['verdict' => Validation::UNKNOWN, 'reason' => 'bad_response'];
        }
        return ['verdict' => Validation::UNKNOWN, 'reason' => self::reasonFor($response['status'], $response['body'])];
    }

    /**
     * A known address, to tell the administrator whether the server key works (the "Test the server key" button).
     *
     * @return array{ok: bool, reason: string}
     */
    public function test(): array
    {
        $result = $this->validate([
            'regionCode' => 'US', 'postalCode' => '94043', 'administrativeArea' => 'CA', 'locality' => 'Mountain View',
            'addressLines' => ['1600 Amphitheatre Parkway'],
        ]);
        $ok = in_array($result['verdict'], [Validation::OK, Validation::CHECK], true);
        return ['ok' => $ok, 'reason' => $ok ? 'working' : $result['reason']];
    }

    private static function reasonFor(int $status, string $body): string
    {
        $text = strtolower($body);
        if ($status === 429 || str_contains($text, 'resource_exhausted') || str_contains($text, 'quota')) {
            return 'quota';
        }
        if ($status === 401 || str_contains($text, 'api key not valid') || str_contains($text, 'api_key_invalid')) {
            return 'auth';
        }
        if ($status === 403 || str_contains($text, 'permission_denied') || str_contains($text, 'has not been used') || str_contains($text, 'referer') || str_contains($text, 'ip address restriction')) {
            return 'api';
        }
        if ($status === 400) {
            return 'bad_request';
        }
        return 'server';
    }
}
