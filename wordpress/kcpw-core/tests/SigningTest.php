<?php
declare(strict_types=1);

namespace KcPrintworks\Core\Tests;

use KcPrintworks\Core\Auth\MemoryNonceStore;
use KcPrintworks\Core\Auth\RequestSigner;
use KcPrintworks\Core\Auth\RequestVerifier;
use KcPrintworks\Core\Support\Json;

final class SigningTest extends TestCase
{
    private const SECRET = '0123456789abcdef0123456789abcdef-test-secret-not-real';

    public function testSharedVectorsMatchTheTypeScriptSigner(): void
    {
        $file = dirname(__DIR__, 3) . '/packages/contracts/test/vectors/signing.json';
        if (!is_file($file)) {
            $this->skip('shared vectors not found');
        }
        $vectors = Json::decode((string) file_get_contents($file));
        $this->assertSame(self::SECRET, $vectors->secret);
        foreach ($vectors->cases as $c) {
            $this->assertSame($c->bodySha256, hash('sha256', $c->body), "{$c->name}: body hash");
            $this->assertSame(
                $c->signature,
                RequestSigner::sign($vectors->secret, $c->timestamp, $c->nonce, $c->method, $c->route, $c->body),
                "{$c->name}: signature",
            );
        }
    }

    /** @return array<string,string> */
    private function signed(string $body, int $ts, string $nonce = 'nonce-nonce-nonce-1', string $method = 'POST', string $route = '/kcpw/v1/cart/handoff'): array
    {
        return [
            'x-kcpw-timestamp' => (string) $ts,
            'x-kcpw-nonce' => $nonce,
            'x-kcpw-signature' => RequestSigner::sign(self::SECRET, (string) $ts, $nonce, $method, $route, $body),
        ];
    }

    public function testAcceptsAGoodRequestOnceAndRefusesAReplay(): void
    {
        $v = new RequestVerifier(self::SECRET, new MemoryNonceStore());
        $headers = $this->signed('{"a":1}', 1_800_000_000);
        $this->assertSame('ok', $v->verify('POST', '/kcpw/v1/cart/handoff', '{"a":1}', $headers, 1_800_000_010));
        $this->assertSame('replay', $v->verify('POST', '/kcpw/v1/cart/handoff', '{"a":1}', $headers, 1_800_000_011));
    }

    public function testRefusesTamperedStaleAndUnsignedRequests(): void
    {
        $v = new RequestVerifier(self::SECRET, new MemoryNonceStore());
        $headers = $this->signed('{"a":1}', 1_800_000_000);
        $this->assertSame('bad_signature', $v->verify('POST', '/kcpw/v1/cart/handoff', '{"a":2}', $headers, 1_800_000_001), 'body changed');
        $this->assertSame('bad_signature', $v->verify('POST', '/kcpw/v1/cart/quote', '{"a":1}', $headers, 1_800_000_001), 'route changed');
        $this->assertSame('bad_signature', $v->verify('GET', '/kcpw/v1/cart/handoff', '{"a":1}', $headers, 1_800_000_001), 'method changed');
        $this->assertSame('stale', $v->verify('POST', '/kcpw/v1/cart/handoff', '{"a":1}', $headers, 1_800_000_000 + 301), 'too old');
        $this->assertSame('stale', $v->verify('POST', '/kcpw/v1/cart/handoff', '{"a":1}', $headers, 1_800_000_000 - 301), 'too new');
        $this->assertSame('missing_headers', $v->verify('POST', '/kcpw/v1/cart/handoff', '{"a":1}', [], 1_800_000_001));
        $bad = $headers;
        $bad['x-kcpw-signature'] = str_repeat('0', 64);
        $this->assertSame('bad_signature', $v->verify('POST', '/kcpw/v1/cart/handoff', '{"a":1}', $bad, 1_800_000_001));
        $short = $headers;
        $short['x-kcpw-nonce'] = 'short';
        $this->assertSame('missing_headers', $v->verify('POST', '/kcpw/v1/cart/handoff', '{"a":1}', $short, 1_800_000_001));
    }

    public function testAWrongSecretOrNoSecretNeverAuthenticates(): void
    {
        $headers = $this->signed('{}', 1_800_000_000);
        $other = new RequestVerifier('a-completely-different-secret-of-sufficient-length', new MemoryNonceStore());
        $this->assertSame('bad_signature', $other->verify('POST', '/kcpw/v1/cart/handoff', '{}', $headers, 1_800_000_001));
        foreach (['', 'short'] as $secret) {
            $off = new RequestVerifier($secret, new MemoryNonceStore());
            $this->assertSame('not_configured', $off->verify('POST', '/kcpw/v1/cart/handoff', '{}', $headers, 1_800_000_001), 'secret: ' . var_export($secret, true));
        }
    }

    public function testAnInvalidRequestDoesNotUseUpANonce(): void
    {
        $store = new MemoryNonceStore();
        $v = new RequestVerifier(self::SECRET, $store);
        $headers = $this->signed('{}', 1_800_000_000);
        $forged = $headers;
        $forged['x-kcpw-signature'] = str_repeat('a', 64);
        $this->assertSame('bad_signature', $v->verify('POST', '/kcpw/v1/cart/handoff', '{}', $forged, 1_800_000_001));
        $this->assertSame('ok', $v->verify('POST', '/kcpw/v1/cart/handoff', '{}', $headers, 1_800_000_002), 'the real request still works');
    }
}
