<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Tests;

use KcPrintworks\Etsy\Admin\Denied;
use KcPrintworks\Etsy\Admin\Gateway;
use KcPrintworks\Etsy\Admin\Redirect;

final class FakeGateway implements Gateway
{
    /** @var list<string> */
    public array $caps = ['manage_options', 'manage_woocommerce'];
    public bool $post = true;
    /** @var array<string,string> */
    public array $params = [];
    /** @var array<string,array<string,string>> */
    public array $arrays = [];
    public bool $nonceValid = true;
    public string $user = 'owner (admin)';

    public function can(string $capability): bool
    {
        return in_array($capability, $this->caps, true);
    }

    public function nonce(string $action): string
    {
        return 'nonce-' . $action;
    }

    public function verifyNonce(?string $nonce, string $action): bool
    {
        return $this->nonceValid && $nonce === 'nonce-' . $action;
    }

    public function isPost(): bool
    {
        return $this->post;
    }

    public function param(string $key): ?string
    {
        return $this->params[$key] ?? null;
    }

    public function params(string $key): array
    {
        return $this->arrays[$key] ?? [];
    }

    public function userLabel(): string
    {
        return $this->user;
    }

    public function now(): string
    {
        return '2026-10-14T12:00:00+00:00';
    }

    public function adminUrl(string $tab = 'connection', array $args = []): string
    {
        return 'https://shop.example.com/wp-admin/admin.php?' . http_build_query(['page' => 'kcpw-etsy', 'tab' => $tab] + $args);
    }

    public function actionUrl(string $action, array $args = []): string
    {
        return 'https://shop.example.com/wp-admin/admin-post.php?' . http_build_query(['action' => $action] + $args);
    }

    public function callbackUrl(): string
    {
        return 'https://shop.example.com/wp-json/kcpw-etsy/v1/oauth/callback';
    }

    public function redirect(string $url): never
    {
        throw new Redirect($url);
    }

    public function deny(string $message, int $status = 403): never
    {
        throw new Denied($message, $status);
    }
}
