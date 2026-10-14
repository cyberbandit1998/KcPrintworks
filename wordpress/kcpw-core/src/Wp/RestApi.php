<?php
declare(strict_types=1);

namespace KcPrintworks\Core\Wp;

use KcPrintworks\Core\Auth\RequestVerifier;
use KcPrintworks\Core\Cart\RequestError;
use KcPrintworks\Core\Handoff\HandoffRequest;
use KcPrintworks\Core\Handoff\HandoffService;
use KcPrintworks\Core\Reviews\ReviewResult;
use KcPrintworks\Core\Reviews\ReviewService;
use KcPrintworks\Core\Support\Json;

/**
 * Server-to-server endpoints for the storefront (never called from a browser):
 *
 *   POST /wp-json/kcpw/v1/cart/quote     validate and price line intents; stores nothing
 *   POST /wp-json/kcpw/v1/cart/handoff   validate, store, return the single-use checkout URL
 *   POST /wp-json/kcpw/v1/reviews        save a customer review as PENDING (never published here; see Reviews\ReviewService)
 *   GET  /wp-json/kcpw/v1/status         is the link set up (no secrets, no customer data)
 *
 * Every request must carry the signature headers described in Auth\RequestSigner.
 */
final class RestApi
{
    public const NAMESPACE = 'kcpw/v1';

    public function __construct(
        private readonly HandoffService $service,
        private readonly RequestVerifier $verifier,
        private readonly string $version,
        private readonly ?ReviewService $reviews = null,
    ) {
    }

    public function register(): void
    {
        add_action('rest_api_init', [$this, 'routes']);
    }

    public function routes(): void
    {
        $post = fn (bool $store): array => [
            'methods' => 'POST',
            'callback' => fn (\WP_REST_Request $r) => $this->cart($r, $store),
            'permission_callback' => [$this, 'authorize'],
        ];
        register_rest_route(self::NAMESPACE, '/cart/quote', $post(false));
        register_rest_route(self::NAMESPACE, '/cart/handoff', $post(true));
        if ($this->reviews !== null) {
            register_rest_route(self::NAMESPACE, '/reviews', [
                'methods' => 'POST',
                'callback' => [$this, 'review'],
                'permission_callback' => [$this, 'authorize'],
            ]);
        }
        register_rest_route(self::NAMESPACE, '/status', [
            'methods' => 'GET',
            'callback' => [$this, 'status'],
            'permission_callback' => [$this, 'authorize'],
        ]);
    }

    /** @return true|\WP_Error */
    public function authorize(\WP_REST_Request $request): bool|\WP_Error
    {
        $headers = [];
        foreach (['x-kcpw-timestamp', 'x-kcpw-nonce', 'x-kcpw-signature'] as $name) {
            $value = $request->get_header($name);
            if (is_string($value)) {
                $headers[$name] = $value;
            }
        }
        $result = $this->verifier->verify($request->get_method(), $request->get_route(), (string) $request->get_body(), $headers, time());
        if ($result === RequestVerifier::OK) {
            return true;
        }
        if ($result === RequestVerifier::NOT_CONFIGURED) {
            return new \WP_Error('kcpw_not_configured', 'The checkout link is not set up on this site (KCPW_HANDOFF_SECRET).', ['status' => 503]);
        }
        // Say nothing about which check failed.
        return new \WP_Error('kcpw_unauthorized', 'Not authorized.', ['status' => 401]);
    }

    public function cart(\WP_REST_Request $request, bool $store): \WP_REST_Response
    {
        try {
            $parsed = HandoffRequest::parse((string) $request->get_body());
        } catch (RequestError $e) {
            return $this->respond(['ok' => false, 'status' => 'invalid_request', 'problems' => $e->problems], 400);
        }
        try {
            $result = $store ? $this->service->create($parsed->lines, $parsed->expectedSubtotal) : $this->service->quote($parsed->lines, $parsed->expectedSubtotal);
        } catch (\Throwable $e) {
            return $this->respond(['ok' => false, 'status' => 'server_error'], 500);
        }
        return $this->respond($result->toArray(), $result->httpStatus());
    }

    public function review(\WP_REST_Request $request): \WP_REST_Response
    {
        if ($this->reviews === null) {
            return $this->respond(['ok' => false, 'status' => 'server_error'], 500);
        }
        try {
            $body = Json::decode((string) $request->get_body());
        } catch (\JsonException $e) {
            return $this->respond(['ok' => false, 'status' => ReviewResult::INVALID, 'problems' => [['field' => '', 'code' => 'invalid_type', 'message' => 'The request is not valid JSON.']]], 400);
        }
        try {
            $result = $this->reviews->submit($body);
        } catch (\Throwable $e) {
            return $this->respond(['ok' => false, 'status' => ReviewResult::ERROR], 500);
        }
        return $this->respond($result->toArray(), $result->httpStatus());
    }

    public function status(\WP_REST_Request $request): \WP_REST_Response
    {
        $stripe = Readiness::stripe();
        $storefront = Config::storefrontUrl();
        return $this->respond([
            'ok' => true,
            'plugin' => $this->version,
            'woocommerce' => function_exists('WC') ? (string) WC()->version : null,
            'currency' => function_exists('get_woocommerce_currency') ? (string) get_woocommerce_currency() : null,
            'storefrontUrlConfigured' => $storefront !== '',
            // Where this shop sends a shopper back to (an expired or already-used link). The storefront compares it with its own
            // address and refuses to hand a cart over to a shop that would return shoppers to a different site (0.2.1).
            'storefrontUrl' => $storefront !== '' ? $storefront : null,
            'stripeActive' => $stripe['active'],
            'stripeTestMode' => $stripe['testMode'],
            'reviewsRoute' => $this->reviews !== null,
        ], 200);
    }

    /** @param array<string,mixed> $data */
    private function respond(array $data, int $status): \WP_REST_Response
    {
        $response = new \WP_REST_Response($data, $status);
        $response->header('Cache-Control', 'no-store');
        return $response;
    }
}
