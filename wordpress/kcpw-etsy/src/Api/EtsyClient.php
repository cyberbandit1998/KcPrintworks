<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Api;

use KcPrintworks\Etsy\Http\Request;
use KcPrintworks\Etsy\Http\Response;
use KcPrintworks\Etsy\Http\Transport;
use KcPrintworks\Etsy\Oauth\NeedsReauth;
use KcPrintworks\Etsy\Oauth\TokenSource;

/**
 * Read-only client for the Etsy Open API v3 application endpoints.
 *
 * It exposes GET reads only (there is no method that writes), and the transport it is given is expected to be
 * wrapped in Http\ReadOnlyTransport as a second, independent guard. Endpoint paths and field names are from the
 * public v3 documentation and are To verify against the vendored OpenAPI spec (docs/ETSY-INTEGRATION.md section 16).
 *
 * Etsy is NEVER called while a shopper's request is being served: this class is used by admin actions and
 * background jobs only.
 */
final class EtsyClient
{
    public const API_BASE = 'https://api.etsy.com/v3/application';
    public const PAGE_SIZE = 100;
    private const MAX_RETRY_WAIT = 60;

    private ?Quota $quota = null;

    /** @var callable(int):void */
    private $sleep;

    /** @param (callable(int):void)|null $sleep seconds; injectable so tests do not wait */
    public function __construct(
        private readonly Transport $transport,
        private readonly TokenSource $tokens,
        private readonly ApiKeyHeader $apiKey,
        private readonly string $base = self::API_BASE,
        ?callable $sleep = null,
        private readonly int $maxAttempts = 4,
    ) {
        $this->sleep = $sleep ?? static function (int $seconds): void {
            sleep($seconds);
        };
    }

    public function lastQuota(): ?Quota
    {
        return $this->quota;
    }

    /** @return array<string,mixed> {user_id, shop_id} */
    public function getMe(): array
    {
        return $this->get('/users/me');
    }

    /** @return array<string,mixed> */
    public function getShop(int $shopId): array
    {
        return $this->get('/shops/' . $shopId);
    }

    /**
     * One page of a shop's listings in a given state (active, inactive, sold_out, draft, expired).
     * @return array{count:int,results:list<array<string,mixed>>}
     */
    public function getListings(int $shopId, string $state, int $limit = self::PAGE_SIZE, int $offset = 0): array
    {
        $data = $this->get('/shops/' . $shopId . '/listings', ['state' => $state, 'limit' => $limit, 'offset' => $offset]);
        return ['count' => (int) ($data['count'] ?? 0), 'results' => array_values((array) ($data['results'] ?? []))];
    }

    /**
     * All listings in the given states, page by page.
     * @param list<string> $states
     * @return \Generator<int,array<string,mixed>>
     */
    public function iterateListings(int $shopId, array $states): \Generator
    {
        foreach ($states as $state) {
            $offset = 0;
            do {
                $page = $this->getListings($shopId, $state, self::PAGE_SIZE, $offset);
                foreach ($page['results'] as $listing) {
                    yield $listing;
                }
                $offset += self::PAGE_SIZE;
            } while ($offset < $page['count'] && $page['results'] !== []);
        }
    }

    /** @return array<string,mixed> */
    public function getListing(int $listingId): array
    {
        return $this->get('/listings/' . $listingId);
    }

    /** @return array<string,mixed> products with property values, SKUs, and offerings */
    public function getInventory(int $listingId): array
    {
        return $this->get('/listings/' . $listingId . '/inventory');
    }

    /** @return array{count:int,results:list<array<string,mixed>>} */
    public function getImages(int $listingId): array
    {
        $data = $this->get('/listings/' . $listingId . '/images');
        return ['count' => (int) ($data['count'] ?? 0), 'results' => array_values((array) ($data['results'] ?? []))];
    }

    /**
     * @param array<string,scalar> $query
     * @return array<string,mixed>
     */
    private function get(string $path, array $query = []): array
    {
        $url = rtrim($this->base, '/') . $path . ($query !== [] ? '?' . http_build_query($query, '', '&', PHP_QUERY_RFC3986) : '');
        $refreshed = false;

        for ($attempt = 1; ; $attempt++) {
            $response = $this->transport->send(new Request('GET', $url, [
                'x-api-key' => $this->apiKey->value(),
                'Authorization' => 'Bearer ' . $this->tokens->accessToken(),
                'Accept' => 'application/json',
            ]));
            $this->quota = Quota::fromResponse($response);

            if ($response->ok()) {
                try {
                    return $response->json();
                } catch (\RuntimeException) {
                    throw new ApiError('Etsy returned a response that is not JSON.', $response->status);
                }
            }

            $status = $response->status;
            if ($status === 401) {
                if ($refreshed) {
                    throw new NeedsReauth('Etsy rejected the access token after a refresh. Reconnect the shop.');
                }
                $refreshed = true;
                $this->tokens->forceRefresh();
                $attempt--; // a 401 followed by a refresh does not use up a retry
                continue;
            }
            if ($status === 403) {
                throw new AccessDenied('Etsy refused access (HTTP 403). Check the granted scopes and that the Seller App is approved for this shop.', 403);
            }
            if ($status === 404) {
                throw new NotFound('Etsy has no such resource (HTTP 404).', 404);
            }
            $retryable = $status === 429 || $status >= 500;
            if (!$retryable || $attempt >= $this->maxAttempts) {
                throw new ApiError(sprintf('Etsy API request failed with HTTP %d.%s', $status, $this->message($response)), $status);
            }
            ($this->sleep)($this->waitSeconds($response, $attempt));
        }
    }

    private function waitSeconds(Response $response, int $attempt): int
    {
        $retryAfter = $response->header('retry-after');
        if ($retryAfter !== null && ctype_digit($retryAfter)) {
            return min(self::MAX_RETRY_WAIT, max(1, (int) $retryAfter));
        }
        return min(self::MAX_RETRY_WAIT, 2 ** ($attempt - 1));
    }

    /** A short, safe excerpt of Etsy's error text (no headers, so no tokens). */
    private function message(Response $response): string
    {
        $data = json_decode($response->body, true);
        $text = is_array($data) ? ($data['error'] ?? $data['message'] ?? '') : '';
        $text = is_string($text) ? trim(preg_replace('/\s+/', ' ', $text) ?? '') : '';
        return $text === '' ? '' : ' ' . mb_substr($text, 0, 160);
    }
}
