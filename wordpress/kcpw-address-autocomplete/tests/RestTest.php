<?php
declare(strict_types=1);

namespace KcPrintworks\AddressAutocomplete\Tests;

use KcPrintworks\AddressAutocomplete\Rest;
use KcPrintworks\AddressAutocomplete\Settings;
use KcPrintworks\AddressAutocomplete\Usage;

final class RestTest extends TestCase
{
    private function request(string $body, string $origin = ''): object
    {
        return new class ($body, $origin) {
            public function __construct(private string $body, private string $origin)
            {
            }
            public function get_body(): string
            {
                return $this->body;
            }
            public function get_header(string $name): string
            {
                return strtolower($name) === 'origin' ? $this->origin : '';
            }
        };
    }

    private function rest(array $override = [], ?\KcPrintworks\AddressAutocomplete\Http $google = null, ?\KcPrintworks\AddressAutocomplete\Http $safe = null): Rest
    {
        return new Rest(Settings::load($override), $google, $safe);
    }

    private const SERVER_KEY = 'ServerKeyServerKeyServerKey0123456789';
    private const GOOD = '{"result":{"verdict":{"addressComplete":true,"validationGranularity":"PREMISE"}}}';
    private const ADDRESS = '{"regionCode":"US","postalCode":"48501","administrativeArea":"MI","locality":"Flint","addressLines":["12 Main Street"],"formId":"f_abc12345"}';

    /** Validation on, a server key saved, plugin Live. */
    private function live(array $more = []): array
    {
        return $more + ['mode' => 'live', 'browser_key' => 'BrowserKeyBrowserKeyBrowserKey01', 'server_key' => self::SERVER_KEY, 'modules' => ['validation' => true]];
    }

    public function testTheUsageRouteIsRegisteredOnRestInit(): void
    {
        $this->rest()->register();
        \WpStub::run('rest_api_init');
        $route = \WpStub::$routes['kcpw-aa/v1/usage'];
        $this->assertSame('POST', $route['methods']);
        $this->assertSame('__return_true', $route['permission_callback']);
        $this->assertSame(1, count(\WpStub::$routes), 'nothing else is exposed');
    }

    public function testACleanBeaconIsStoredAsNumbersOnly(): void
    {
        $res = $this->rest()->usage($this->request('{"r":3,"d":1,"s":1,"m":0,"e":{"auth":1},"address":"12 Main St","q":"typed"}'));
        $this->assertSame(204, $res->status);
        $stored = \WpStub::$options[Usage::OPTION];
        $day = $stored['days'][gmdate('Y-m-d')];
        $this->assertSame(3, $day['r']);
        $this->assertSame(['auth' => 1], $day['e']);
        $this->assertNotContains('Main', (string) json_encode($stored));
        $this->assertNotContains('typed', (string) json_encode($stored));
        $this->assertSame(false, \WpStub::$autoload[Usage::OPTION], 'never autoloaded on every page');
    }

    public function testNothingIsWrittenWhenCountersAreOffOrTheBodyIsUseless(): void
    {
        $this->rest(['usage_counters' => false])->usage($this->request('{"r":3}'));
        $this->assertSame([], \WpStub::$options);
        $this->rest()->usage($this->request(''));
        $this->rest()->usage($this->request('not json'));
        $this->rest()->usage($this->request('{"address":"x"}'));
        $this->rest()->usage($this->request('{"r":1,"pad":"' . str_repeat('x', 3000) . '"}'));
        $this->assertSame([], \WpStub::$options);
    }

    public function testAnotherSitesOriginIsRefusedAndOursIsAccepted(): void
    {
        $res = $this->rest()->usage($this->request('{"r":1}', 'https://evil.example.test'));
        $this->assertSame(403, $res->status);
        $this->assertSame([], \WpStub::$options);
        $this->assertSame(204, $this->rest()->usage($this->request('{"r":1}', 'https://shop.example.test'))->status);
        $this->assertSame(1, \WpStub::$options[Usage::OPTION]['days'][gmdate('Y-m-d')]['r']);
    }

    public function testAFloodIsDroppedBeforeAnyWrite(): void
    {
        for ($i = 0; $i < 20; $i++) {
            $this->rest()->usage($this->request('{"r":1}'));
        }
        $this->assertSame(20, \WpStub::$options[Usage::OPTION]['days'][gmdate('Y-m-d')]['r']);
        $this->rest()->usage($this->request('{"r":1}'));
        $this->assertSame(20, \WpStub::$options[Usage::OPTION]['days'][gmdate('Y-m-d')]['r'], 'the 21st in a minute from one visitor is dropped');
        $_SERVER['REMOTE_ADDR'] = '198.51.100.7';
        $this->rest()->usage($this->request('{"r":1}'));
        $this->assertSame(21, \WpStub::$options[Usage::OPTION]['days'][gmdate('Y-m-d')]['r'], 'another visitor has their own allowance');
    }

    public function testTheFeatureRoutesDoNotExistUntilTheirFeatureIsOn(): void
    {
        $this->rest()->register();
        \WpStub::run('rest_api_init');
        $this->assertSame(['kcpw-aa/v1/usage'], array_keys(\WpStub::$routes), 'a default install exposes one route');

        \WpStub::reset();
        $this->rest(['server_key' => self::SERVER_KEY, 'modules' => ['validation' => true]])->register();
        \WpStub::run('rest_api_init');
        $this->assertTrue(isset(\WpStub::$routes['kcpw-aa/v1/validate']));
        $this->assertFalse(isset(\WpStub::$routes['kcpw-aa/v1/hint']));
        $this->assertFalse(isset(\WpStub::$routes['kcpw-aa/v1/checkout-start']));

        \WpStub::reset();
        $this->rest(['modules' => ['validation' => true]])->register();
        \WpStub::run('rest_api_init');
        $this->assertFalse(isset(\WpStub::$routes['kcpw-aa/v1/validate']), 'no server key, no route');

        \WpStub::reset();
        $this->rest(['optins' => ['ip' => ['enabled' => true], 'abandonment' => ['enabled' => true]]])->register();
        \WpStub::run('rest_api_init');
        $this->assertSame('GET', \WpStub::$routes['kcpw-aa/v1/hint']['methods']);
        $this->assertSame('POST', \WpStub::$routes['kcpw-aa/v1/checkout-start']['methods']);
    }

    public function testAnAddressCheckReturnsAVerdictAndNothingElse(): void
    {
        $google = new FakeHttp(['status' => 200, 'body' => self::GOOD]);
        $res = $this->rest($this->live(), $google)->validate($this->request(self::ADDRESS));
        $this->assertSame(200, $res->status);
        $this->assertSame(['verdict' => 'ok', 'reason' => 'confirmed'], $res->data);
        $this->assertSame(1, count($google->calls));
        $this->assertSame(self::SERVER_KEY, $google->calls[0]['headers']['X-Goog-Api-Key']);
        $this->assertNotContains(self::SERVER_KEY, (string) json_encode($res->data), 'the key never goes back to the browser');
        $day = \WpStub::$options[Usage::OPTION]['days'][gmdate('Y-m-d')];
        $this->assertSame(1, $day['v'], 'the server counts the check');
        $this->assertNotContains('Main', (string) json_encode(\WpStub::$options), 'the address is never stored');
        $this->assertNotContains('Flint', (string) json_encode(\WpStub::$transients), 'nor cached in the clear');
    }

    public function testTheSameAddressIsAskedOfGoogleOnlyOncePerDay(): void
    {
        $google = new FakeHttp(['status' => 200, 'body' => self::GOOD]);
        $rest = $this->rest($this->live(), $google);
        $rest->validate($this->request(self::ADDRESS));
        $again = $rest->validate($this->request(self::ADDRESS));
        $this->assertSame(1, count($google->calls), 'the second answer came from the cache');
        $this->assertSame('ok', $again->data['verdict']);
        $this->assertSame(1, \WpStub::$options[Usage::OPTION]['days'][gmdate('Y-m-d')]['v'], 'a cached answer costs nothing and is not counted');
    }

    public function testGatesPreviewOffAndOtherSites(): void
    {
        $google = new FakeHttp(['status' => 200, 'body' => self::GOOD]);
        $this->assertSame(403, $this->rest($this->live(['mode' => 'preview']), $google)->validate($this->request(self::ADDRESS))->status, 'a customer in preview mode is refused');
        \WpStub::$canManage = true;
        $this->assertSame(200, $this->rest($this->live(['mode' => 'preview']), $google)->validate($this->request(self::ADDRESS))->status, 'an administrator is answered');
        \WpStub::$canManage = false;
        $this->assertSame(404, $this->rest($this->live(['mode' => 'off']), $google)->validate($this->request(self::ADDRESS))->status);
        $this->assertSame(403, $this->rest($this->live(), $google)->validate($this->request(self::ADDRESS, 'https://evil.example.test'))->status);
        $this->assertSame(404, $this->rest($this->live(['server_key' => '']), $google)->validate($this->request(self::ADDRESS))->status, 'no key, no call');
        $this->assertSame(1, count($google->calls), 'only the administrator\'s request reached Google');
    }

    public function testBadBodiesAreRefusedBeforeAnyCallToGoogle(): void
    {
        $google = new FakeHttp(['status' => 200, 'body' => self::GOOD]);
        $rest = $this->rest($this->live(), $google);
        foreach (['', 'not json', '{"regionCode":"US"}', '{"regionCode":"USA","addressLines":["x"]}', str_repeat('x', 3000)] as $body) {
            $this->assertSame(400, $rest->validate($this->request($body))->status);
        }
        $this->assertSame(0, count($google->calls));
    }

    public function testAFloodOfChecksIsLimitedPerVisitorAndPerDay(): void
    {
        $google = new FakeHttp(['status' => 200, 'body' => self::GOOD]);
        $rest = $this->rest($this->live(), $google);
        $statuses = [];
        for ($i = 0; $i < 12; $i++) {
            $statuses[] = $rest->validate($this->request(str_replace('12 Main', $i . ' Main', self::ADDRESS)))->status;
        }
        $this->assertSame(10, count(array_filter($statuses, static fn (int $s): bool => $s === 200)));
        $this->assertSame(2, count(array_filter($statuses, static fn (int $s): bool => $s === 429)));
        $this->assertSame(10, count($google->calls));

        \WpStub::reset();
        $google = new FakeHttp(['status' => 200, 'body' => self::GOOD]);
        $rest = $this->rest($this->live(['validation_daily_cap' => 10]), $google);
        for ($i = 0; $i < 12; $i++) {
            $_SERVER['REMOTE_ADDR'] = '198.51.100.' . $i;
            $res = $rest->validate($this->request(str_replace('12 Main', $i . ' Main', self::ADDRESS)));
        }
        $this->assertSame(10, count($google->calls), 'the day\'s ceiling holds whoever asks');
        $this->assertSame(['verdict' => 'unknown', 'reason' => 'cap'], $res->data);
    }

    public function testAFailureIsCountedAsAnErrorNeverCachedAndNeverLeaksTheKey(): void
    {
        $google = new FakeHttp(['status' => 403, 'body' => '{"error":{"status":"PERMISSION_DENIED","message":"has not been used in project"}}']);
        $rest = $this->rest($this->live(), $google);
        $res = $rest->validate($this->request(self::ADDRESS));
        $this->assertSame(['verdict' => 'unknown', 'reason' => 'api'], $res->data);
        $this->assertSame(1, \WpStub::$options[Usage::OPTION]['days'][gmdate('Y-m-d')]['e']['api']);
        $rest->validate($this->request(self::ADDRESS));
        $this->assertSame(2, count($google->calls), 'a failure is not remembered as an answer');
        $this->assertNotContains(self::SERVER_KEY, (string) json_encode(\WpStub::$options));
    }

    public function testTheWebhookHearsAboutAProblemOnceAndOnlyWhenOptedIn(): void
    {
        $bad = '{"result":{"verdict":{"addressComplete":false,"validationGranularity":"ROUTE"}}}';
        $google = new FakeHttp(['status' => 200, 'body' => $bad]);
        $safe = new FakeHttp(['status' => 200, 'body' => '']);
        $this->rest($this->live(), $google, $safe)->validate($this->request(self::ADDRESS));
        $this->assertSame(0, count($safe->calls), 'off by default');

        $hook = ['optins' => ['webhook' => ['enabled' => true, 'consent' => true, 'url' => 'https://hooks.example.test/in', 'events' => ['bad']]]];
        \WpStub::reset();
        $rest = $this->rest($this->live($hook), $google, $safe);
        $rest->validate($this->request(self::ADDRESS));
        $this->assertSame(1, count($safe->calls));
        $this->assertNotContains('Main Street', $safe->calls[0]['body'], 'no address unless the owner asked for it');
        $this->assertContains('f_abc12345', $safe->calls[0]['body']);
        $rest->validate($this->request(self::ADDRESS));
        $this->assertSame(1, count($safe->calls), 'the same address does not ring twice within the hour');
    }

    public function testAWebhookThatBreaksNeverReachesTheCustomer(): void
    {
        $google = new FakeHttp(['status' => 200, 'body' => '{"result":{"verdict":{"addressComplete":false}}}']);
        $safe = new class () implements \KcPrintworks\AddressAutocomplete\Http {
            public function post(string $url, array $headers, string $body, int $timeout, bool $blocking = true): ?array
            {
                throw new \RuntimeException('receiver exploded');
            }
            public function get(string $url, array $headers, int $timeout): ?array
            {
                return null;
            }
        };
        $hook = ['optins' => ['webhook' => ['enabled' => true, 'consent' => true, 'url' => 'https://hooks.example.test/in', 'events' => ['bad']]]];
        $res = $this->rest($this->live($hook), $google, $safe)->validate($this->request(self::ADDRESS));
        $this->assertSame(200, $res->status);
        $this->assertSame('bad', $res->data['verdict']);
    }

    public function testThePoBoxWebhookEventComesFromTheSameCheck(): void
    {
        $google = new FakeHttp(['status' => 200, 'body' => self::GOOD]);
        $safe = new FakeHttp();
        $hook = ['optins' => ['webhook' => ['enabled' => true, 'consent' => true, 'url' => 'https://hooks.example.test/in', 'events' => ['pobox']]]];
        $this->rest($this->live($hook), $google, $safe)->validate($this->request(str_replace('12 Main Street', 'PO Box 12', self::ADDRESS)));
        $this->assertSame(1, count($safe->calls));
        $this->assertContains('"result":"pobox"', $safe->calls[0]['body']);
    }

    public function testTheLocationHintFromAHeaderMakesNoOutsideCall(): void
    {
        $safe = new FakeHttp();
        $settings = ['mode' => 'live', 'optins' => ['ip' => ['enabled' => true, 'source' => 'header']]];
        $_SERVER['HTTP_CF_IPCOUNTRY'] = 'DE';
        $res = $this->rest($settings, null, $safe)->hint($this->request(''));
        unset($_SERVER['HTTP_CF_IPCOUNTRY']);
        $this->assertSame(['country' => 'DE'], $res->data);
        $this->assertSame(0, count($safe->calls));
        $this->assertTrue(in_array('nocache', \WpStub::$headers, true));
        $empty = $this->rest($settings, null, $safe)->hint($this->request(''));
        $this->assertSame(200, $empty->status);
        $this->assertSame('{}', json_encode($empty->data), 'no header: an empty object, not an error');
    }

    public function testTheLocationHintFromAServiceIsRoundedCachedAndNeverFedAPrivateAddress(): void
    {
        $safe = new FakeHttp(['status' => 200, 'body' => '{"country_code":"US","latitude":43.0123,"longitude":-83.6876,"city":"Flint","ip":"203.0.113.9"}']);
        $settings = ['mode' => 'live', 'optins' => ['ip' => ['enabled' => true, 'source' => 'service', 'service_url' => 'https://geo.example.test/json/{ip}']]];
        $rest = $this->rest($settings, null, $safe);
        $res = $rest->hint($this->request(''));
        $this->assertSame(['country' => 'US', 'lat' => 43.0, 'lng' => -83.7], $res->data, 'a city-sized position and nothing else of the service\'s answer');
        $this->assertSame('https://geo.example.test/json/203.0.113.9', $safe->calls[0]['url']);
        $rest->hint($this->request(''));
        $this->assertSame(1, count($safe->calls), 'the second visit is answered from the cache');
        $this->assertNotContains('203.0.113.9', (string) json_encode(array_keys(\WpStub::$transients)), 'the address is not a cache key in the clear');

        \WpStub::reset();
        $_SERVER['REMOTE_ADDR'] = '10.1.2.3';
        $safe2 = new FakeHttp($safe->answer);
        $this->assertSame('{}', json_encode($this->rest($settings, null, $safe2)->hint($this->request(''))->data));
        $this->assertSame(0, count($safe2->calls), 'a private address is never sent anywhere');
    }

    public function testTheHintFollowsPreviewAndOffToo(): void
    {
        $settings = ['mode' => 'preview', 'optins' => ['ip' => ['enabled' => true]]];
        $this->assertSame(403, $this->rest($settings)->hint($this->request(''))->status);
        $this->assertSame(404, $this->rest(['mode' => 'off'] + $settings)->hint($this->request(''))->status);
    }

    public function testCheckoutStartsAreCountedAsANumberAndRateLimited(): void
    {
        $rest = $this->rest(['mode' => 'live', 'optins' => ['abandonment' => ['enabled' => true]]]);
        for ($i = 0; $i < 8; $i++) {
            $this->assertSame(204, $rest->checkoutStart($this->request(''))->status);
        }
        $this->assertSame(6, \WpStub::$options[Usage::OPTION]['days'][gmdate('Y-m-d')]['cs'], 'six a minute per visitor, the rest ignored');
        $this->assertSame(403, $this->rest(['mode' => 'live', 'optins' => ['abandonment' => ['enabled' => true]]])->checkoutStart($this->request('', 'https://evil.example.test'))->status);
    }

    public function testTheVerdictCacheCanBeSwitchedOffAndNeverHoldsGoogleSAnswer(): void
    {
        $google = new FakeHttp(['status' => 200, 'body' => self::GOOD]);
        $off = new Rest(Settings::load($this->live()), $google, null, 0);
        $off->validate($this->request(self::ADDRESS));
        $off->validate($this->request(self::ADDRESS));
        $this->assertSame(2, count($google->calls), 'nothing remembered, so Google is asked each time');
        $this->assertFalse(array_filter(array_keys(\WpStub::$transients), static fn (string $k): bool => str_starts_with($k, 'kcpw_aa_v_')) !== [], 'no verdict is held when the cache is off');
        \WpStub::reset();
        $google = new FakeHttp(['status' => 200, 'body' => '{"result":{"verdict":{"addressComplete":true,"validationGranularity":"PREMISE"},"address":{"formattedAddress":"12 Main St, Flint MI 48501, USA"}}}']);
        (new Rest(Settings::load($this->live()), $google))->validate($this->request(self::ADDRESS));
        $held = (string) json_encode(\WpStub::$transients);
        $this->assertNotContains('formattedAddress', $held, 'Google\'s own answer is never kept');
        $this->assertNotContains('12 Main St', $held);
        $this->assertContains('confirmed', $held, 'only our verdict and reason');
    }
}
