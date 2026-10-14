<?php
declare(strict_types=1);

namespace KcPrintworks\Core\Wp;

use KcPrintworks\Core\Handoff\HandoffService;
use KcPrintworks\Core\Handoff\Redemption;

/**
 * GET /?kcpw_handoff=<token> : the shopper's browser arrives from the storefront. The token is used once, the cart is
 * rebuilt from today's catalog by WooCommerce's own add-to-cart, and the shopper is sent to the WooCommerce checkout.
 * Anything wrong sends them back to the storefront cart with a reason; nothing is silently changed.
 */
final class Redeemer
{
    public const QUERY = 'kcpw_handoff';
    public const SESSION_KEY = 'kcpw_last_handoff';

    public function __construct(private readonly HandoffService $service)
    {
    }

    public function register(): void
    {
        add_action('template_redirect', [$this, 'maybeRedeem'], 1);
    }

    public function maybeRedeem(): void
    {
        if (!isset($_GET[self::QUERY])) {
            return;
        }
        $token = sanitize_text_field(wp_unslash((string) $_GET[self::QUERY]));
        nocache_headers();
        header('Referrer-Policy: no-referrer');

        if (function_exists('wc_load_cart') && (!function_exists('WC') || WC()->cart === null)) {
            wc_load_cart();
        }
        if (!function_exists('WC') || WC()->cart === null || WC()->session === null) {
            $this->back('unavailable');
            return;
        }

        $hash = HandoffService::hashToken($token);
        $redemption = $this->service->redeem($token);

        if (!$redemption->ok) {
            if ($redemption->code === Redemption::INVALID_TOKEN && WC()->session->get(self::SESSION_KEY) === $hash) {
                // The shopper reloaded or went back: they already have this cart. Send them on to checkout.
                $this->go(wc_get_checkout_url());
                return;
            }
            $this->back($redemption->code === Redemption::CHANGED ? 'changed' : 'expired');
            return;
        }

        WC()->cart->empty_cart(true);
        WC()->cart->remove_coupons();
        wc_clear_notices();
        CartHooks::$building = true;
        $failed = false;
        try {
            foreach ($redemption->calls as $call) {
                $data = ['kcpw' => ['options' => $call->options, 'summary' => $call->summary, 'schemaVersion' => 1]];
                $key = WC()->cart->add_to_cart($call->productId, $call->quantity, $call->variationId, $call->variationAttributes, $data);
                if ($key === false) {
                    $failed = true;
                    break;
                }
            }
        } finally {
            CartHooks::$building = false;
        }
        if ($failed) {
            WC()->cart->empty_cart(true);
            wc_clear_notices();
            $this->back('unavailable');
            return;
        }

        WC()->session->set_customer_session_cookie(true);
        WC()->session->set(self::SESSION_KEY, $hash);
        $this->go(wc_get_checkout_url());
    }

    private function back(string $reason): void
    {
        $storefront = Config::storefrontUrl();
        $this->go($storefront !== '' ? $storefront . '/cart/?handoff=' . rawurlencode($reason) : wc_get_cart_url());
    }

    private function go(string $url): void
    {
        // The target is our own checkout URL or the storefront address from wp-config.php, never anything from the request.
        wp_redirect($url);
        exit;
    }
}
