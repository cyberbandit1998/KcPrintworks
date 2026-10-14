<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Http;

/**
 * Guarantees the read-only phase at the lowest level. Allowed:
 *  - GET to the Etsy application API base (reads),
 *  - exactly one non-GET: POST to the OAuth token URL (code exchange and refresh).
 * Everything else, including any PUT, PATCH, DELETE, or POST to a listing, inventory, or receipt URL, throws
 * before any network activity. Plain http and URLs with embedded credentials are refused too.
 */
final class ReadOnlyTransport implements Transport
{
    public function __construct(
        private readonly Transport $inner,
        private readonly string $apiBase,
        private readonly string $tokenUrl,
    ) {
    }

    public function send(Request $request): Response
    {
        $method = strtoupper($request->method);
        $parts = parse_url($request->url);
        if (!is_array($parts) || ($parts['scheme'] ?? '') !== 'https' || isset($parts['user']) || isset($parts['pass'])) {
            throw new WriteBlocked('Only https URLs without embedded credentials are allowed.');
        }
        $isRead = $method === 'GET' && $this->startsWith($request->url, rtrim($this->apiBase, '/') . '/');
        $isTokenCall = $method === 'POST' && $this->sameEndpoint($request->url, $this->tokenUrl);
        if (!$isRead && !$isTokenCall) {
            throw new WriteBlocked(sprintf('Blocked %s request: the read-only phase only allows GET reads and the OAuth token call.', $method));
        }
        return $this->inner->send($request);
    }

    private function startsWith(string $value, string $prefix): bool
    {
        return strncmp($value, $prefix, strlen($prefix)) === 0;
    }

    private function sameEndpoint(string $url, string $expected): bool
    {
        $a = parse_url($url);
        $b = parse_url($expected);
        return is_array($a) && is_array($b)
            && ($a['host'] ?? '') === ($b['host'] ?? '#')
            && ($a['path'] ?? '') === ($b['path'] ?? '#');
    }
}
