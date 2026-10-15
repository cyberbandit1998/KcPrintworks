<?php
declare(strict_types=1);

namespace KcPrintworks\Quotes\Wp;

use KcPrintworks\Quotes\Auth\RequestVerifier;
use KcPrintworks\Quotes\Service\Customer;
use KcPrintworks\Quotes\Service\Intake;
use KcPrintworks\Quotes\Service\IntakeResult;
use KcPrintworks\Quotes\Support\Json;

/**
 * Server-to-server endpoints for the storefront (never called from a browser):
 *
 *   POST /wp-json/kcpw-quotes/v1/requests        a customer's quote request (with pictures), saved as New
 *   POST /wp-json/kcpw-quotes/v1/quote/view      what a private link shows
 *   POST /wp-json/kcpw-quotes/v1/quote/approve   the customer's approval: makes the pending order and returns its payment address
 *   GET  /wp-json/kcpw-quotes/v1/status          is it set up (no secrets, no customer data)
 *
 * Every request must carry the signature headers described in Auth\RequestSigner (the same scheme and secret as kcpw-core). Nothing here
 * can set a price, a status or an order: the bodies are strict and the rules read amounts from the stored quote.
 */
final class RestApi
{
    public const NAMESPACE = 'kcpw-quotes/v1';

    /** @param callable(): array<string,mixed> $health */
    public function __construct(
        private readonly Intake $intake,
        private readonly Customer $customer,
        private readonly RequestVerifier $verifier,
        private readonly string $version,
        private $health,
    ) {
    }

    public function register(): void
    {
        add_action('rest_api_init', [$this, 'routes']);
    }

    public function routes(): void
    {
        foreach ([['/requests', 'requests'], ['/quote/view', 'view'], ['/quote/approve', 'approve']] as [$route, $method]) {
            register_rest_route(self::NAMESPACE, $route, [
                'methods' => 'POST',
                'callback' => [$this, $method],
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
            return new \WP_Error('kcpw_not_configured', 'Custom quotes are not set up on this site (KCPW_HANDOFF_SECRET).', ['status' => 503]);
        }
        // Say nothing about which check failed.
        return new \WP_Error('kcpw_unauthorized', 'Not authorized.', ['status' => 401]);
    }

    public function requests(\WP_REST_Request $request): \WP_REST_Response
    {
        $body = $this->decode($request);
        if ($body === null) {
            return $this->respond(['ok' => false, 'status' => IntakeResult::INVALID], 400);
        }
        if (function_exists('wp_raise_memory_limit')) {
            wp_raise_memory_limit('image');
        }
        try {
            $result = $this->intake->submit($body);
        } catch (\Throwable) {
            return $this->respond(['ok' => false, 'status' => IntakeResult::ERROR], 500);
        }
        return $this->respond($result->toArray(), $result->httpStatus());
    }

    public function view(\WP_REST_Request $request): \WP_REST_Response
    {
        $body = $this->decode($request);
        [$ref, $token] = $this->linkOf($body);
        if ($ref === null) {
            return $this->respond(['ok' => false, 'status' => 'invalid_link'], 404);
        }
        try {
            $answer = $this->customer->view($ref, $token);
        } catch (\Throwable) {
            return $this->respond(['ok' => false, 'status' => 'unavailable'], 503);
        }
        return $this->respond($answer, self::httpStatus($answer));
    }

    public function approve(\WP_REST_Request $request): \WP_REST_Response
    {
        $body = $this->decode($request);
        [$ref, $token] = $this->linkOf($body, ['approval']);
        if ($ref === null || !($body instanceof \stdClass)) {
            return $this->respond(['ok' => false, 'status' => 'invalid_link'], 404);
        }
        try {
            $answer = $this->customer->approve($ref, $token, $body->approval ?? null);
        } catch (\Throwable) {
            return $this->respond(['ok' => false, 'status' => 'unavailable'], 503);
        }
        return $this->respond($answer, self::httpStatus($answer));
    }

    public function status(\WP_REST_Request $request): \WP_REST_Response
    {
        return $this->respond(['ok' => true, 'plugin' => $this->version] + ($this->health)(), 200);
    }

    /** @param array<string,mixed> $answer */
    public static function httpStatus(array $answer): int
    {
        if (($answer['ok'] ?? false) === true) {
            return 200;
        }
        return match ($answer['status'] ?? '') {
            'invalid_link' => 404,
            'invalid_request' => 400,
            'expired' => 410,
            'terms_changed', 'not_open', 'busy', 'not_payable' => 409,
            'unavailable' => 503,
            default => 500,
        };
    }

    private function decode(\WP_REST_Request $request): mixed
    {
        try {
            return Json::decode((string) $request->get_body());
        } catch (\JsonException) {
            return null;
        }
    }

    /**
     * @param list<string> $also other keys the body may have
     * @return array{0:?string,1:string} the reference and token, or [null, ''] when the body is not exactly that
     */
    private function linkOf(mixed $body, array $also = []): array
    {
        if (!($body instanceof \stdClass)) {
            return [null, ''];
        }
        $extra = array_diff(array_keys(get_object_vars($body)), array_merge(['ref', 'token'], $also));
        if ($extra !== [] || !is_string($body->ref ?? null) || !is_string($body->token ?? null)) {
            return [null, ''];
        }
        return [$body->ref, $body->token];
    }

    /** @param array<string,mixed> $data */
    private function respond(array $data, int $status): \WP_REST_Response
    {
        $response = new \WP_REST_Response($data, $status);
        $response->header('Cache-Control', 'no-store');
        return $response;
    }
}
