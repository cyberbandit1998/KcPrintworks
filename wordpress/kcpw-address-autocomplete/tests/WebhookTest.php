<?php
declare(strict_types=1);

namespace KcPrintworks\AddressAutocomplete\Tests;

use KcPrintworks\AddressAutocomplete\IpHint;
use KcPrintworks\AddressAutocomplete\Settings;
use KcPrintworks\AddressAutocomplete\Webhook;
use KcPrintworks\AddressAutocomplete\WpHttp;

final class WebhookTest extends TestCase
{
    private const ADDRESS = ['regionCode' => 'US', 'postalCode' => '48501', 'administrativeArea' => 'MI', 'locality' => 'Flint', 'addressLines' => ['12 Main Street']];

    /** @param array<string, mixed> $webhook */
    private function settings(array $webhook = []): array
    {
        $raw = ['webhook' => $webhook + ['enabled' => true, 'consent' => true, 'url' => 'https://hooks.example.test/in', 'events' => ['bad', 'pobox']]];
        return Settings::applySection(Settings::defaults(), ['optins' => $raw], 'optins');
    }

    public function testNothingIsSentUnlessEverythingIsSwitchedOn(): void
    {
        $http = new FakeHttp();
        $this->assertFalse(Webhook::send($http, Settings::defaults(), 'bad', 'shop.test', []), 'off by default');
        $this->assertFalse(Webhook::send($http, $this->settings(['consent' => false]), 'bad', 'shop.test', []), 'no consent');
        $this->assertFalse(Webhook::send($http, $this->settings(['url' => 'http://insecure.test/x']), 'bad', 'shop.test', []), 'not https');
        $this->assertFalse(Webhook::send($http, $this->settings(), 'check', 'shop.test', []), 'an event the owner did not pick');
        $this->assertFalse(Webhook::send($http, $this->settings(), 'made_up', 'shop.test', []), 'an unknown event');
        $this->assertSame(0, count($http->calls));
    }

    public function testByDefaultThePayloadHasNoAddressInIt(): void
    {
        $http = new FakeHttp();
        $this->assertTrue(Webhook::send($http, $this->settings(), 'bad', 'shop.test', ['formId' => 'f_abc12345', 'address' => self::ADDRESS]));
        $call = $http->calls[0];
        $this->assertSame('https://hooks.example.test/in', $call['url']);
        $this->assertFalse($call['blocking'], 'fire and forget: never waits for the receiver');
        $this->assertNotContains('Main Street', $call['body']);
        $this->assertNotContains('48501', $call['body']);
        $this->assertNotContains('Flint', $call['body']);
        $payload = json_decode($call['body'], true);
        $this->assertSame('bad', $payload['result']);
        $this->assertSame('shop.test', $payload['site']);
    }

    public function testTheAddressIsIncludedOnlyWithItsOwnSeparateSwitch(): void
    {
        $http = new FakeHttp();
        Webhook::send($http, $this->settings(['include_address' => true]), 'bad', 'shop.test', ['address' => self::ADDRESS]);
        $this->assertContains('12 Main Street', $http->calls[0]['body']);
    }

    public function testSlackGetsItsOwnShapeAndTheAddressRuleStillHolds(): void
    {
        $http = new FakeHttp();
        $s = $this->settings(['url' => 'https://hooks.slack.com/services/T0/B0/xyz']);
        Webhook::send($http, $s, 'pobox', 'shop.test', ['formId' => 'f_x', 'address' => self::ADDRESS]);
        $body = json_decode($http->calls[0]['body'], true);
        $this->assertSame(['text'], array_keys($body));
        $this->assertNotContains('Main Street', $http->calls[0]['body']);
    }

    public function testWpHttpGoesThroughTheSafeFunctionsForAdministratorAddresses(): void
    {
        \WpStub::$httpAnswers = [['response' => ['code' => 200], 'body' => 'ok']];
        $r = (new WpHttp(true))->post('https://hooks.example.test/in', ['A' => 'b'], '{}', 3, false);
        $this->assertSame(['status' => 202, 'body' => ''], $r, 'not waiting for an answer');
        $this->assertSame(true, \WpStub::$http[0][2]['safe'], 'the safe variant refuses the server\'s own network');
        $this->assertSame(0, \WpStub::$http[0][2]['redirection'], 'no redirects followed');
        $this->assertSame(false, \WpStub::$http[0][2]['blocking']);
        \WpStub::$http = [];
        $google = (new WpHttp(false))->get('https://x.test/', [], 3);
        $this->assertSame(['status' => 200, 'body' => 'ok'], $google);
        $this->assertSame(false, \WpStub::$http[0][2]['safe']);
        \WpStub::$http = [];
        \WpStub::$httpAnswers = [new \WP_Error('http_request_failed', 'nope')];
        $this->assertSame(null, (new WpHttp(true))->get('https://x.test/', [], 3), 'a failure is null, never an exception');
    }

    public function testIpHeaderHintIsACountryOrNothing(): void
    {
        $this->assertSame(['country' => 'GB'], IpHint::fromHeader(['HTTP_CF_IPCOUNTRY' => 'gb']));
        $this->assertSame(null, IpHint::fromHeader(['HTTP_CF_IPCOUNTRY' => 'XX']));
        $this->assertSame(null, IpHint::fromHeader(['HTTP_CF_IPCOUNTRY' => 'T1']));
        $this->assertSame(null, IpHint::fromHeader(['HTTP_CF_IPCOUNTRY' => 'USA']));
        $this->assertSame(null, IpHint::fromHeader(['HTTP_CF_IPCOUNTRY' => ['US']]));
        $this->assertSame(null, IpHint::fromHeader([]));
    }

    public function testTheLookupServiceIsNeverGivenAPrivateAddressAndTheResultIsRounded(): void
    {
        $template = 'https://geo.example.test/json/{ip}';
        $this->assertSame('https://geo.example.test/json/203.0.113.9', IpHint::serviceUrl($template, '203.0.113.9'));
        $this->assertSame(null, IpHint::serviceUrl($template, '10.0.0.5'));
        $this->assertSame(null, IpHint::serviceUrl($template, '192.168.1.1'));
        $this->assertSame(null, IpHint::serviceUrl($template, '127.0.0.1'));
        $this->assertSame(null, IpHint::serviceUrl($template, 'not an ip'));
        $this->assertSame(null, IpHint::serviceUrl('http://geo.example.test/{ip}', '203.0.113.9'), 'http is refused');
        $this->assertSame(null, IpHint::serviceUrl('https://geo.example.test/', '203.0.113.9'), 'the {ip} marker is needed');
        $this->assertSame(['country' => 'US', 'lat' => 43.0, 'lng' => -83.7], IpHint::parseService(['country_code' => 'us', 'latitude' => 43.0123, 'longitude' => -83.6876]));
        $this->assertSame(['country' => 'CA'], IpHint::parseService(['countryCode' => 'CA', 'lat' => 999, 'lon' => 5]));
        $this->assertSame(null, IpHint::parseService(['country' => 'Narnia']));
        $this->assertSame(null, IpHint::parseService([]));
    }
}
