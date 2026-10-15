<?php
declare(strict_types=1);

namespace KcPrintworks\Quotes\Wp;

use KcPrintworks\Quotes\Auth\RequestVerifier;
use KcPrintworks\Quotes\Mail\Emails;
use KcPrintworks\Quotes\Service\Context;
use KcPrintworks\Quotes\Service\Customer;
use KcPrintworks\Quotes\Service\Intake;
use KcPrintworks\Quotes\Service\Payments;
use KcPrintworks\Quotes\Service\Privacy;
use KcPrintworks\Quotes\Upload\GdImageSanitizer;
use KcPrintworks\Quotes\Upload\PassThroughSanitizer;

/** Puts the parts together and hands them to WordPress. Nothing here runs a query until a request, a hook or a screen needs it. */
final class Plugin
{
    public const CRON_HOOK = 'kcpw_quotes_expire';

    public static function boot(string $version): void
    {
        $settings = Config::settings();
        $repo = WpdbQuoteRepository::forSite();
        $files = WpFileStore::forSite();
        $orders = new WcOrderGateway();
        $mailer = new WpMailer();
        $emails = new Emails($settings);
        $clock = static fn (): int => time();
        $adminUrl = static fn (int $id): string => AdminScreens::quoteUrl($id);
        $sanitizer = GdImageSanitizer::available() ? new GdImageSanitizer() : new PassThroughSanitizer();
        $context = new Context($repo, $orders, $mailer, $emails, $settings, $files, $clock, $adminUrl);
        $payments = new Payments($context);
        $customer = new Customer($context, $payments);
        $intake = new Intake($repo, $files, $sanitizer, $mailer, $emails, $settings, $clock, $adminUrl);

        (new RestApi($intake, $customer, new RequestVerifier($settings->secret, new WpNonceStore()), $version, static fn (): array => self::health($settings, $sanitizer->redraws())))->register();
        (new OrderHooks($payments, $repo, $settings, $orders))->register();
        (new PrivacyHooks(new Privacy($context)))->register();
        add_action(self::CRON_HOOK, static function () use ($payments): void {
            $payments->expireDue(100);
        });
        if (is_admin()) {
            (new AdminScreens($repo, new \KcPrintworks\Quotes\Service\Admin($context), $orders, $files, $settings, new AdminViews($settings), $mailer))->register();
        }
    }

    /** What the signed /status route says: no secrets and no customer data. @return array<string,mixed> */
    private static function health(\KcPrintworks\Quotes\Service\Settings $settings, bool $redraws): array
    {
        $stripe = HealthProbe::stripe();
        return [
            'woocommerce' => function_exists('WC') ? (string) WC()->version : null,
            'currency' => function_exists('get_woocommerce_currency') ? (string) get_woocommerce_currency() : null,
            'decimals' => function_exists('wc_get_price_decimals') ? (int) wc_get_price_decimals() : null,
            'storefrontUrlConfigured' => $settings->storefrontUrl !== '',
            'storefrontUrl' => $settings->storefrontUrl !== '' ? $settings->storefrontUrl : null,
            'picturesRedrawn' => $redraws,
            'stripeActive' => $stripe['active'],
            'stripeTestMode' => $stripe['testMode'],
            'taxable' => $settings->taxable,
        ];
    }
}
