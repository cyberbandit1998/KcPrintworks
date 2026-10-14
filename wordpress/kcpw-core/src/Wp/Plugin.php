<?php
declare(strict_types=1);

namespace KcPrintworks\Core\Wp;

use KcPrintworks\Core\Auth\RequestVerifier;
use KcPrintworks\Core\Cart\LineResolver;
use KcPrintworks\Core\Handoff\HandoffService;
use KcPrintworks\Core\Reviews\ReviewService;

final class Plugin
{
    public const PURGE_HOOK = 'kcpw_core_purge';

    public static function boot(string $version): void
    {
        $service = new HandoffService(
            new WcProductSource(),
            new WpHandoffStore(),
            new LineResolver(),
            (string) home_url(),
            static fn (): int => time(),
        );
        (new RestApi($service, new RequestVerifier(Config::secret(), new WpNonceStore()), $version, new ReviewService(new WcReviewGateway())))->register();
        (new Redeemer($service))->register();
        (new CartHooks())->register();
        (new PersonalizationPanel())->register();
        if (is_admin()) {
            (new AdminPage())->register();
        }
        add_action(self::PURGE_HOOK, static function (): void {
            global $wpdb;
            $table = Schema::table();
            $wpdb->query($wpdb->prepare("DELETE FROM {$table} WHERE expires_at < %d", time()));
        });
    }
}
