<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Tests;

use KcPrintworks\Etsy\Vault\TokenVault;

final class VaultTest extends TestCase
{
    private const MATERIAL = 'a-long-random-key-material-for-tests-only-0123456789';

    public function testRoundTrip(): void
    {
        $key = TokenVault::keyFromMaterial(self::MATERIAL);
        $stored = TokenVault::encrypt('{"access_token":"1.secret"}', $key);
        $this->assertStringNotContains('secret', $stored);
        $this->assertSame('{"access_token":"1.secret"}', TokenVault::decrypt($stored, $key));
    }

    public function testEveryEncryptionIsDifferent(): void
    {
        $key = TokenVault::keyFromMaterial(self::MATERIAL);
        $this->assertTrue(TokenVault::encrypt('same', $key) !== TokenVault::encrypt('same', $key));
    }

    public function testTamperingWrongKeyAndGarbageAreRejectedNotCrashed(): void
    {
        $key = TokenVault::keyFromMaterial(self::MATERIAL);
        $stored = TokenVault::encrypt('secret', $key);
        $tampered = substr($stored, 0, -2) . (substr($stored, -2) === 'AA' ? 'BB' : 'AA');
        $this->assertNull(TokenVault::decrypt($tampered, $key));
        $this->assertNull(TokenVault::decrypt($stored, TokenVault::keyFromMaterial(self::MATERIAL . 'x')));
        foreach (['', 'v1.', 'v1.!!!', 'v2.abcd', 'plain'] as $garbage) {
            $this->assertNull(TokenVault::decrypt($garbage, $key), $garbage);
        }
    }

    public function testShortKeyMaterialIsRefused(): void
    {
        $this->assertThrows(\InvalidArgumentException::class, fn () => TokenVault::keyFromMaterial('short'));
    }
}
