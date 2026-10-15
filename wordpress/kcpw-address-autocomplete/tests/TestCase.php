<?php
declare(strict_types=1);

namespace KcPrintworks\AddressAutocomplete\Tests;

abstract class TestCase
{
    public int $assertions = 0;

    protected function assertSame(mixed $expected, mixed $actual, string $message = ''): void
    {
        $this->assertions++;
        if ($expected !== $actual) {
            throw new \RuntimeException(($message !== '' ? $message . ': ' : '') . 'expected ' . var_export($expected, true) . ', got ' . var_export($actual, true));
        }
    }

    protected function assertTrue(mixed $condition, string $message = ''): void
    {
        $this->assertSame(true, $condition === true, $message !== '' ? $message : 'expected true');
    }

    protected function assertFalse(mixed $condition, string $message = ''): void
    {
        $this->assertSame(false, $condition === true, $message !== '' ? $message : 'expected false');
    }

    protected function assertContains(string $needle, string $haystack, string $message = ''): void
    {
        $this->assertTrue(str_contains($haystack, $needle), ($message !== '' ? $message . ': ' : '') . "expected to find '$needle'");
    }

    protected function assertNotContains(string $needle, string $haystack, string $message = ''): void
    {
        $this->assertFalse(str_contains($haystack, $needle), ($message !== '' ? $message . ': ' : '') . "did not expect '$needle'");
    }

    /** @param callable(): mixed $fn */
    protected function assertThrows(callable $fn, string $contains = '', string $message = ''): void
    {
        $this->assertions++;
        try {
            $fn();
        } catch (\Throwable $e) {
            if ($contains !== '' && !str_contains($e->getMessage(), $contains)) {
                throw new \RuntimeException(($message !== '' ? $message . ': ' : '') . "threw '{$e->getMessage()}', expected it to contain '$contains'");
            }
            return;
        }
        throw new \RuntimeException(($message !== '' ? $message . ': ' : '') . 'expected an exception');
    }
}
