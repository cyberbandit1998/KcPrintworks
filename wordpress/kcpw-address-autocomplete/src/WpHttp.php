<?php
declare(strict_types=1);

namespace KcPrintworks\AddressAutocomplete;

/**
 * {@see Http} over WordPress's HTTP functions. With `$safe` it uses the "safe" variants, which refuse addresses that point at the
 * server's own network (private and reserved ranges), as every address an administrator typed in (a webhook, an IP lookup service)
 * must; Google's fixed address uses the ordinary ones.
 */
final class WpHttp implements Http
{
    public function __construct(private readonly bool $safe)
    {
    }

    public function post(string $url, array $headers, string $body, int $timeout, bool $blocking = true): ?array
    {
        $args = ['headers' => $headers, 'body' => $body, 'timeout' => $timeout, 'redirection' => 0, 'blocking' => $blocking];
        $response = $this->safe ? wp_safe_remote_post($url, $args) : wp_remote_post($url, $args);
        return $this->read($response, $blocking);
    }

    public function get(string $url, array $headers, int $timeout): ?array
    {
        $args = ['headers' => $headers, 'timeout' => $timeout, 'redirection' => 0];
        $response = $this->safe ? wp_safe_remote_get($url, $args) : wp_remote_get($url, $args);
        return $this->read($response, true);
    }

    /** @return array{status: int, body: string}|null */
    private function read(mixed $response, bool $blocking): ?array
    {
        if (is_wp_error($response)) {
            return null;
        }
        if (!$blocking) {
            return ['status' => 202, 'body' => ''];
        }
        return ['status' => (int) wp_remote_retrieve_response_code($response), 'body' => (string) wp_remote_retrieve_body($response)];
    }
}
