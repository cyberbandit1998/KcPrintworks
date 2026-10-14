<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Admin;

/**
 * Everything the admin actions need from WordPress, behind one interface, so the security rules (capability, nonce,
 * method, single-use state) are tested without WordPress. Wp\WpGateway is the real implementation.
 */
interface Gateway
{
    public function can(string $capability): bool;

    public function nonce(string $action): string;

    public function verifyNonce(?string $nonce, string $action): bool;

    public function isPost(): bool;

    /** A sanitized scalar request parameter, or null. */
    public function param(string $key): ?string;

    /** @return array<string,string> an array request parameter such as decision[123]=ignore */
    public function params(string $key): array;

    public function userLabel(): string;

    public function now(): string;

    /** @param array<string,string|int> $args */
    public function adminUrl(string $tab = 'connection', array $args = []): string;

    /**
     * URL of a WordPress admin-post handler (admin-post.php?action=...). Forms post to it; downloads link to it.
     * @param array<string,string|int> $args
     */
    public function actionUrl(string $action, array $args = []): string;

    public function callbackUrl(): string;

    /** Sends the browser elsewhere and stops. Tests throw Redirect instead. */
    public function redirect(string $url): never;

    /** Stops with an error page. Tests throw Denied instead. */
    public function deny(string $message, int $status = 403): never;
}
