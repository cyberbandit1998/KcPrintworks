<?php
declare(strict_types=1);

namespace KcPrintworks\AddressAutocomplete;

/**
 * The opt-in webhook: a short message sent to an address the owner chose (Slack, Zapier, a script of their own) when an address check
 * finds a problem. OFF until the owner switches it on, ticks the consent box and gives an https address ({@see Settings::optInEnabled()}).
 *
 * What it sends, by default: that a check found a problem, which kind, the site and the form. NO ADDRESS. The address (the lines the
 * customer typed, and their city, state, postal code and country) is added only if the owner ticks the separate "include the address"
 * box, which says in plain words that customer data will leave this site.
 */
final class Webhook
{
    public const EVENTS = ['bad' => 'could not be verified', 'check' => 'needs a second look', 'pobox' => 'looks like a PO box or military address'];

    /** @param array<string, mixed> $settings */
    public static function wants(array $settings, string $event): bool
    {
        if (!Settings::optInEnabled($settings, 'webhook') || !isset(self::EVENTS[$event])) {
            return false;
        }
        $events = $settings['optins']['webhook']['events'] ?? [];
        return is_array($events) && in_array($event, $events, true);
    }

    /**
     * @param array<string, mixed> $settings
     * @param array{formId?: string, address?: array<string, mixed>|null} $context
     * @return array<string, mixed>
     */
    public static function payload(string $event, array $settings, string $siteHost, array $context): array
    {
        $payload = [
            'event' => 'address_check',
            'result' => $event,
            'meaning' => self::EVENTS[$event] ?? '',
            'site' => $siteHost,
            'form' => (string) ($context['formId'] ?? ''),
            'time' => gmdate('c'),
        ];
        if (($settings['optins']['webhook']['include_address'] ?? false) === true && is_array($context['address'] ?? null)) {
            $payload['address'] = $context['address'];
        }
        return $payload;
    }

    /** Slack's incoming webhooks want {"text": ...}; everything else gets the payload as it is. */
    public static function body(string $url, array $payload): string
    {
        $host = strtolower((string) parse_url($url, PHP_URL_HOST));
        if ($host === 'hooks.slack.com') {
            $text = sprintf('Address check on %s: an address %s (form %s).', (string) ($payload['site'] ?? ''), (string) ($payload['meaning'] ?? ''), (string) ($payload['form'] ?? ''));
            if (isset($payload['address']) && is_array($payload['address'])) {
                $text .= ' ' . implode(', ', array_filter(array_map('strval', array_merge($payload['address']['addressLines'] ?? [], [$payload['address']['locality'] ?? '', $payload['address']['administrativeArea'] ?? '', $payload['address']['postalCode'] ?? '', $payload['address']['regionCode'] ?? '']))));
            }
            return (string) json_encode(['text' => $text]);
        }
        return (string) json_encode($payload, JSON_UNESCAPED_SLASHES);
    }

    /**
     * Sends it, once, without waiting for an answer and without retrying. Returns whether a request was made.
     *
     * @param array<string, mixed> $settings
     * @param array{formId?: string, address?: array<string, mixed>|null} $context
     */
    public static function send(Http $http, array $settings, string $event, string $siteHost, array $context): bool
    {
        if (!self::wants($settings, $event)) {
            return false;
        }
        $url = Settings::webhookUrl($settings['optins']['webhook']['url'] ?? '');
        if ($url === '') {
            return false;
        }
        $payload = self::payload($event, $settings, $siteHost, $context);
        return $http->post($url, ['Content-Type' => 'application/json'], self::body($url, $payload), 3, false) !== null;
    }
}
