<?php
declare(strict_types=1);

namespace KcPrintworks\AddressAutocomplete\Tests;

use KcPrintworks\AddressAutocomplete\GoogleServer;
use KcPrintworks\AddressAutocomplete\Usage;
use KcPrintworks\AddressAutocomplete\Validation;

final class ValidationTest extends TestCase
{
    private function address(array $override = []): array
    {
        return $override + ['regionCode' => 'US', 'postalCode' => '94043', 'administrativeArea' => 'CA', 'locality' => 'Mountain View', 'addressLines' => ['1600 Amphitheatre Parkway']];
    }

    private function verdict(array $v): array
    {
        return Validation::verdict(['result' => ['verdict' => $v]]);
    }

    public function testCleanAddressKeepsOnlyTheFieldsTheApiTakesAndLimitsThem(): void
    {
        $clean = Validation::cleanAddress([
            'regionCode' => 'us', 'postalCode' => '94043', 'administrativeArea' => 'CA', 'locality' => 'Mountain View',
            'addressLines' => ['1600 Amphitheatre <b>Parkway</b>', '', "Suite\n4", 'third', 'fourth'], 'email' => 'a@b.test', 'ip' => '1.2.3.4',
        ]);
        $this->assertSame('US', $clean['regionCode']);
        $this->assertSame(3, count($clean['addressLines']), 'at most three lines');
        $this->assertNotContains('<', (string) json_encode($clean));
        $this->assertNotContains('a@b.test', (string) json_encode($clean));
        $this->assertSame(['regionCode', 'postalCode', 'administrativeArea', 'locality', 'addressLines'], array_keys($clean));
    }

    public function testCleanAddressRefusesWhatCannotBeChecked(): void
    {
        $this->assertSame(null, Validation::cleanAddress('x'));
        $this->assertSame(null, Validation::cleanAddress(['regionCode' => 'USA', 'addressLines' => ['1 Main']]));
        $this->assertSame(null, Validation::cleanAddress(['regionCode' => 'US', 'addressLines' => []]));
        $this->assertSame(null, Validation::cleanAddress(['regionCode' => 'US', 'addressLines' => ['   ']]));
        $this->assertSame(null, Validation::cleanAddress(['regionCode' => 'US']));
        $long = Validation::cleanAddress(['regionCode' => 'US', 'addressLines' => [str_repeat('a', 500)]]);
        $this->assertSame(120, mb_strlen($long['addressLines'][0]));
    }

    public function testTheRequestLeavesOutEmptyParts(): void
    {
        $body = Validation::buildRequest($this->address(['postalCode' => '', 'locality' => '']));
        $this->assertSame(['address' => ['regionCode' => 'US', 'addressLines' => ['1600 Amphitheatre Parkway'], 'administrativeArea' => 'CA']], $body);
    }

    public function testVerdictTable(): void
    {
        $good = ['addressComplete' => true, 'validationGranularity' => 'PREMISE'];
        $this->assertSame(['verdict' => 'ok', 'reason' => 'confirmed'], $this->verdict($good));
        $this->assertSame('ok', $this->verdict(['validationGranularity' => 'SUB_PREMISE'] + $good)['verdict']);
        $this->assertSame(['verdict' => 'check', 'reason' => 'unconfirmed'], $this->verdict($good + ['hasUnconfirmedComponents' => true]));
        $this->assertSame(['verdict' => 'check', 'reason' => 'replaced'], $this->verdict($good + ['hasReplacedComponents' => true]));
        $this->assertSame(['verdict' => 'check', 'reason' => 'street_only'], $this->verdict(['validationGranularity' => 'ROUTE'] + $good));
        $this->assertSame(['verdict' => 'bad', 'reason' => 'incomplete'], $this->verdict(['addressComplete' => false] + $good));
        $this->assertSame(['verdict' => 'bad', 'reason' => 'incomplete'], $this->verdict(['validationGranularity' => 'OTHER']));
        $this->assertSame(['verdict' => 'bad', 'reason' => 'not_found'], $this->verdict(['addressComplete' => true, 'validationGranularity' => 'OTHER']));
        $this->assertSame(['verdict' => 'check', 'reason' => 'unclear'], $this->verdict(['addressComplete' => true, 'validationGranularity' => 'LOCALITY']));
        $this->assertSame(['verdict' => 'unknown', 'reason' => 'no_verdict'], Validation::verdict([]));
        $this->assertSame(['verdict' => 'unknown', 'reason' => 'no_verdict'], Validation::verdict(['result' => ['verdict' => 'garbage']]));
    }

    public function testEveryReasonThatIsAFaultMapsToAnAllowedUsageErrorCode(): void
    {
        foreach (['quota', 'auth', 'api', 'network', 'bad_request', 'server', 'bad_response'] as $reason) {
            $this->assertTrue(in_array(Validation::errorCode($reason), Usage::ERROR_CODES, true), $reason);
        }
        $this->assertSame(null, Validation::errorCode('no_verdict'));
        $this->assertSame(null, Validation::errorCode('cap'));
    }

    public function testTheServerCallUsesTheKeyInAHeaderAndNeverInTheAddress(): void
    {
        $http = new FakeHttp(['status' => 200, 'body' => '{"result":{"verdict":{"addressComplete":true,"validationGranularity":"PREMISE"}}}']);
        $result = (new GoogleServer($http, 'ServerKeyServerKeyServerKey0123'))->validate($this->address());
        $this->assertSame(['verdict' => 'ok', 'reason' => 'confirmed'], $result);
        $call = $http->calls[0];
        $this->assertSame('https://addressvalidation.googleapis.com/v1:validateAddress', $call['url']);
        $this->assertSame('ServerKeyServerKeyServerKey0123', $call['headers']['X-Goog-Api-Key']);
        $this->assertNotContains('ServerKey', $call['url'] . $call['body'], 'the key is never in the address or the body');
        $this->assertContains('1600 Amphitheatre Parkway', $call['body']);
    }

    public function testEveryFailureBecomesAnUnknownVerdictWithAReasonAndNeverThrows(): void
    {
        $cases = [
            [null, 'network'],
            [['status' => 429, 'body' => ''], 'quota'],
            [['status' => 403, 'body' => '{"error":{"status":"RESOURCE_EXHAUSTED"}}'], 'quota'],
            [['status' => 400, 'body' => '{"error":{"message":"API key not valid. Please pass a valid API key."}}'], 'auth'],
            [['status' => 403, 'body' => '{"error":{"status":"PERMISSION_DENIED","message":"Address Validation API has not been used in project"}}'], 'api'],
            [['status' => 403, 'body' => '{"error":{"message":"Requests from referer <empty> are blocked."}}'], 'api'],
            [['status' => 400, 'body' => '{}'], 'bad_request'],
            [['status' => 500, 'body' => ''], 'server'],
            [['status' => 200, 'body' => 'not json'], 'bad_response'],
            [['status' => 200, 'body' => '[]'], 'no_verdict'],
        ];
        foreach ($cases as [$answer, $reason]) {
            $r = (new GoogleServer(new FakeHttp($answer), 'ServerKeyServerKeyServerKey0123'))->validate($this->address());
            $this->assertSame(['verdict' => 'unknown', 'reason' => $reason], $r, $reason);
        }
    }

    public function testTheServerKeyTestReportsWorkingOrTheReason(): void
    {
        $ok = new FakeHttp(['status' => 200, 'body' => '{"result":{"verdict":{"addressComplete":true,"validationGranularity":"PREMISE"}}}']);
        $this->assertSame(['ok' => true, 'reason' => 'working'], (new GoogleServer($ok, 'k'))->test());
        $bad = new FakeHttp(['status' => 403, 'body' => '{"error":{"status":"PERMISSION_DENIED"}}']);
        $this->assertSame(['ok' => false, 'reason' => 'api'], (new GoogleServer($bad, 'k'))->test());
    }
}
