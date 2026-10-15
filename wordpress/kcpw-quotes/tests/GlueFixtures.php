<?php
declare(strict_types=1);

namespace KcPrintworks\Quotes\Tests;

use KcPrintworks\Quotes\Auth\RequestSigner;
use KcPrintworks\Quotes\Mail\Emails;
use KcPrintworks\Quotes\Service\Admin;
use KcPrintworks\Quotes\Service\Context;
use KcPrintworks\Quotes\Wp\Config;
use KcPrintworks\Quotes\Wp\Plugin;
use KcPrintworks\Quotes\Wp\WcOrderGateway;
use KcPrintworks\Quotes\Wp\WpdbQuoteRepository;
use KcPrintworks\Quotes\Wp\WpFileStore;
use KcPrintworks\Quotes\Wp\WpMailer;

/** The plugin booted over the WordPress stand-ins and a SQLite database: what the glue tests drive. */
final class GlueFixtures
{
    public FakeWpdb $db;
    public WpdbQuoteRepository $repo;
    public Context $context;
    public Admin $admin;
    public WcOrderGateway $orders;
    private int $nonce = 0;

    public static function boot(bool $admin = false): self
    {
        \WpStub::reset();
        $self = new self();
        $GLOBALS['wpdb'] = $self->db = new FakeWpdb();
        \WpStub::$uploads = sys_get_temp_dir() . '/kcpw-quotes-test-' . bin2hex(random_bytes(4));
        \WpStub::$isAdmin = $admin;
        register_shutdown_function(static function (): void {
            // Test folders are removed when the run ends.
        });
        Plugin::boot('0.1.0-test');
        $self->repo = WpdbQuoteRepository::forSite();
        $self->orders = new WcOrderGateway();
        $settings = Config::settings();
        $self->context = new Context(
            $self->repo, $self->orders, new WpMailer(), new Emails($settings), $settings, WpFileStore::forSite(),
            static fn (): int => time(), static fn (int $id): string => 'https://shop.example.com/wp-admin/admin.php?page=kcpw-quotes&quote=' . $id,
        );
        $self->admin = new Admin($self->context);
        return $self;
    }

    public function uploads(): string
    {
        return \WpStub::$uploads;
    }

    public function cleanup(): void
    {
        $dir = \WpStub::$uploads;
        if (is_dir($dir)) {
            foreach (glob($dir . '/{,.}*', GLOB_BRACE) ?: [] as $path) {
                if (is_file($path)) {
                    @unlink($path);
                }
            }
            foreach (glob($dir . '/*', GLOB_ONLYDIR) ?: [] as $sub) {
                foreach (glob($sub . '/{,.}*', GLOB_BRACE) ?: [] as $path) {
                    if (is_file($path)) {
                        @unlink($path);
                    }
                }
                @rmdir($sub);
            }
            @rmdir($dir);
        }
    }

    /** A signed request, as the storefront makes it. @param array<string,string>|null $headersOverride */
    public function request(string $method, string $route, string $body, ?string $secret = null, ?int $time = null): \WP_REST_Request
    {
        $secret ??= Config::secret();
        $ts = (string) ($time ?? time());
        $nonce = str_pad('n' . ++$this->nonce . bin2hex(random_bytes(4)), 24, '-');
        return new \WP_REST_Request($method, $route, $body, [
            'X-Kcpw-Timestamp' => $ts,
            'X-Kcpw-Nonce' => $nonce,
            'X-Kcpw-Signature' => RequestSigner::sign($secret, $ts, $nonce, $method, $route, $body),
        ]);
    }

    /** Calls a registered route as WordPress would: permission first, then the callback. @return \WP_REST_Response|\WP_Error */
    public function call(string $method, string $route, string $body = '', ?string $secret = null): mixed
    {
        $key = ltrim($route, '/');
        $args = \WpStub::$routes[$key] ?? null;
        if ($args === null) {
            throw new \RuntimeException('no route ' . $key);
        }
        $request = $this->request($method, $route, $body, $secret);
        $allowed = ($args['permission_callback'])($request);
        if ($allowed !== true) {
            return $allowed;
        }
        return ($args['callback'])($request);
    }
}
