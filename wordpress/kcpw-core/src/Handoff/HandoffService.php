<?php
declare(strict_types=1);

namespace KcPrintworks\Core\Handoff;

use KcPrintworks\Core\Cart\LineIntent;
use KcPrintworks\Core\Cart\LineResolver;
use KcPrintworks\Core\Cart\RequestError;
use KcPrintworks\Core\Catalog\ProductSource;
use KcPrintworks\Core\Support\Json;

/**
 * Cart handoff (docs/PAYMENTS-STRIPE.md section 4).
 *
 *   quote()    validate and price line intents; stores nothing.
 *   create()   validate again; if all is well store the INTENTS server-side and mint a single-use token (10 minutes).
 *   redeem()   take the token (once), validate AGAIN against today's catalog, and return the exact WooCommerce
 *              add-to-cart calls to build the cart with.
 *
 * Prices are never read from a request or from the stored payload: every figure comes from the product source.
 */
final class HandoffService
{
    public const TTL_SECONDS = 600;
    private const TOKEN_PATTERN = '/^[A-Za-z0-9_-]{43}$/';

    /**
     * @param \Closure():int $clock unix seconds
     * @param \Closure():string $newToken 43-character URL-safe token
     */
    public function __construct(
        private readonly ProductSource $products,
        private readonly HandoffStore $store,
        private readonly LineResolver $resolver,
        private readonly string $redirectBase,
        private readonly \Closure $clock,
        private readonly ?\Closure $newToken = null,
    ) {
    }

    public static function randomToken(): string
    {
        return rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
    }

    public static function hashToken(string $token): string
    {
        return hash('sha256', $token);
    }

    /** @param list<LineIntent> $lines */
    public function quote(array $lines, ?int $expectedSubtotal = null): HandoffResult
    {
        $resolved = [];
        $currency = 'USD';
        $subtotal = 0;
        $bad = false;
        foreach ($lines as $intent) {
            $line = $this->resolver->resolve($this->products->find($intent->productId), $intent);
            $resolved[] = $line;
            if ($line->product !== null) {
                $currency = $line->product->currency;
            }
            if ($line->ok()) {
                $subtotal += $line->lineTotalCents();
            } else {
                $bad = true;
            }
        }
        if ($bad) {
            return new HandoffResult(HandoffResult::INVALID, $resolved, $subtotal, $currency);
        }
        if ($expectedSubtotal !== null && $expectedSubtotal !== $subtotal) {
            return new HandoffResult(HandoffResult::CHANGED, $resolved, $subtotal, $currency);
        }
        return new HandoffResult(HandoffResult::OK, $resolved, $subtotal, $currency);
    }

    /** @param list<LineIntent> $lines */
    public function create(array $lines, ?int $expectedSubtotal = null): HandoffResult
    {
        $result = $this->quote($lines, $expectedSubtotal);
        if ($result->status !== HandoffResult::OK) {
            return $result;
        }
        $now = ($this->clock)();
        $token = ($this->newToken ?? [self::class, 'randomToken'])();
        $payload = Json::encode([
            'v' => 1,
            'createdAt' => $now,
            'lines' => array_map(static fn (LineIntent $l): array => [
                'productId' => $l->productId,
                'variationId' => $l->variationId,
                'attributes' => (object) $l->attributes,
                'quantity' => $l->quantity,
                'options' => $l->options,
            ], $lines),
        ]);
        $expiresAt = $now + self::TTL_SECONDS;
        $this->store->put(self::hashToken($token), $payload, $expiresAt);
        return new HandoffResult(
            HandoffResult::OK,
            $result->lines,
            $result->subtotalCents,
            $result->currency,
            rtrim($this->redirectBase, '/') . '/?kcpw_handoff=' . $token,
            $expiresAt,
        );
    }

    public function redeem(string $token): Redemption
    {
        if (!preg_match(self::TOKEN_PATTERN, $token)) {
            return Redemption::failed(Redemption::INVALID_TOKEN);
        }
        $payload = $this->store->take(self::hashToken($token), ($this->clock)());
        if ($payload === null) {
            return Redemption::failed(Redemption::INVALID_TOKEN);
        }
        try {
            $data = Json::decode($payload);
            if (!($data instanceof \stdClass) || !is_array($data->lines ?? null)) {
                return Redemption::failed(Redemption::INVALID_TOKEN);
            }
            $intents = [];
            foreach ($data->lines as $index => $raw) {
                $intents[] = LineIntent::parse($raw, (int) $index);
            }
        } catch (\JsonException | RequestError $e) {
            return Redemption::failed(Redemption::INVALID_TOKEN);
        }

        $calls = [];
        $problems = [];
        foreach ($intents as $index => $intent) {
            $line = $this->resolver->resolve($this->products->find($intent->productId), $intent);
            if (!$line->ok()) {
                $problems[] = ['index' => $index, 'issues' => $line->issues];
                continue;
            }
            $calls[] = new AddCall(
                $intent->productId,
                $line->variation?->id ?? 0,
                $intent->quantity,
                $line->wcVariationAttributes(),
                $line->values,
                $line->summary,
            );
        }
        if ($problems !== []) {
            return Redemption::failed(Redemption::CHANGED, $problems);
        }
        return Redemption::cart($calls);
    }
}
