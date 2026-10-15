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

    private function rest(array $override = []): Rest
    {
        return new Rest(Settings::load($override));
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
}
