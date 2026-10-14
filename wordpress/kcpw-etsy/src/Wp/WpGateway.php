<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Wp;

use KcPrintworks\Etsy\Admin\Gateway;

final class WpGateway implements Gateway
{
    public const PAGE = 'kcpw-etsy';

    public function can(string $capability): bool
    {
        return \current_user_can($capability);
    }

    public function nonce(string $action): string
    {
        return \wp_create_nonce($action);
    }

    public function verifyNonce(?string $nonce, string $action): bool
    {
        return $nonce !== null && $nonce !== '' && \wp_verify_nonce($nonce, $action) !== false;
    }

    public function isPost(): bool
    {
        return isset($_SERVER['REQUEST_METHOD']) && strtoupper((string) $_SERVER['REQUEST_METHOD']) === 'POST';
    }

    public function param(string $key): ?string
    {
        $value = $_POST[$key] ?? $_GET[$key] ?? null; // phpcs:ignore WordPress.Security.NonceVerification -- verified by Actions::guard()
        return is_string($value) ? \sanitize_text_field(\wp_unslash($value)) : null;
    }

    public function params(string $key): array
    {
        $raw = $_POST[$key] ?? null; // phpcs:ignore WordPress.Security.NonceVerification -- verified by Actions::guard()
        if (!is_array($raw)) {
            return [];
        }
        $out = [];
        foreach ($raw as $name => $value) {
            if (is_string($value)) {
                $out[(string) \sanitize_key((string) $name)] = \sanitize_text_field(\wp_unslash($value));
            }
        }
        return $out;
    }

    public function userLabel(): string
    {
        $user = \wp_get_current_user();
        return $user->exists() ? sprintf('%s (#%d)', $user->user_login, $user->ID) : 'unknown';
    }

    public function now(): string
    {
        return gmdate('c');
    }

    public function adminUrl(string $tab = 'connection', array $args = []): string
    {
        return \add_query_arg(['page' => self::PAGE, 'tab' => $tab] + array_map('strval', $args), \admin_url('admin.php'));
    }

    public function actionUrl(string $action, array $args = []): string
    {
        return \add_query_arg(['action' => $action] + array_map('strval', $args), \admin_url('admin-post.php'));
    }

    public function callbackUrl(): string
    {
        return \rest_url('kcpw-etsy/v1/oauth/callback');
    }

    public function redirect(string $url): never
    {
        \wp_safe_redirect($url);
        exit;
    }

    public function deny(string $message, int $status = 403): never
    {
        \wp_die(\esc_html($message), 'Etsy sync', ['response' => $status, 'back_link' => true]);
    }
}
