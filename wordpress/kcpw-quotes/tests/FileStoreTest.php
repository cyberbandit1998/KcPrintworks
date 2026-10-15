<?php
declare(strict_types=1);

namespace KcPrintworks\Quotes\Tests;

use KcPrintworks\Quotes\Wp\WpFileStore;

final class FileStoreTest extends TestCase
{
    private function dir(): string
    {
        return sys_get_temp_dir() . '/kcpw-quotes-store-' . bin2hex(random_bytes(4));
    }

    private function remove(string $dir): void
    {
        foreach (glob($dir . '/{,.}*', GLOB_BRACE) ?: [] as $f) {
            if (is_file($f)) {
                unlink($f);
            }
        }
        @rmdir($dir);
    }

    public function testStoringReadingAndDeletingAPictureByItsRandomName(): void
    {
        \WpStub::reset();
        $dir = $this->dir();
        $store = new WpFileStore($dir);
        $name = bin2hex(random_bytes(20));
        $store->put($name, "\x89PNG-bytes");
        $this->assertSame("\x89PNG-bytes", $store->read($name));
        $this->assertSame(0640, fileperms($dir . '/' . $name) & 0777);
        $this->assertSame([], glob($dir . '/*.tmp') ?: [], 'no half-written files are left');
        $store->delete($name);
        $this->assertNull($store->read($name));
        $store->delete($name); // deleting twice is fine
        $this->remove($dir);
    }

    public function testTheFolderIsMadeUnservableAndNamesCannotEscapeIt(): void
    {
        \WpStub::reset();
        $dir = $this->dir();
        $store = new WpFileStore($dir);
        $this->assertTrue($store->prepare());
        $this->assertStringContains('Require all denied', (string) file_get_contents($dir . '/.htaccess'));
        $this->assertStringContains('Deny from all', (string) file_get_contents($dir . '/.htaccess'));
        $this->assertTrue(is_file($dir . '/index.html'));
        $this->assertTrue(is_file($dir . '/web.config'));
        foreach (['../escape', 'abc', str_repeat('A', 40), str_repeat('g', 40), str_repeat('a', 41), '', str_repeat('a', 39) . '/', '.htaccess', 'index.html'] as $bad) {
            $this->assertThrows(\InvalidArgumentException::class, fn () => $store->put($bad, 'x'));
            $this->assertThrows(\InvalidArgumentException::class, fn () => $store->read($bad));
            $this->assertThrows(\InvalidArgumentException::class, fn () => $store->delete($bad));
        }
        $files = array_map('basename', array_filter(glob($dir . '/{,.}*', GLOB_BRACE) ?: [], 'is_file'));
        sort($files);
        $this->assertSame(['.htaccess', 'index.html', 'web.config'], $files, 'nothing but the guard files was written');
        $this->remove($dir);
    }

    public function testAFolderThatCannotBeWrittenIsReportedNotIgnored(): void
    {
        \WpStub::reset();
        $store = new WpFileStore('/proc/definitely-not-writable/kcpw');
        $this->assertFalse($store->prepare());
        $this->assertThrows(\RuntimeException::class, fn () => $store->put(bin2hex(random_bytes(20)), 'x'));
        $this->assertFalse((new WpFileStore(''))->prepare());
        $this->assertFalse((new WpFileStore('relative/path'))->prepare());
    }
}
