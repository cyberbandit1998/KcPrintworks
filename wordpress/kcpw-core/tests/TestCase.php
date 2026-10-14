<?php
declare(strict_types=1);

namespace KcPrintworks\Core\Tests;

/** A tiny dependency-free test harness (the sandbox and many WordPress hosts cannot install PHPUnit). */
abstract class TestCase
{
    public int $assertions = 0;

    protected function skip(string $reason): never
    {
        throw new Skipped($reason);
    }

    protected function assertSame(mixed $expected, mixed $actual, string $message = ''): void
    {
        $this->assertions++;
        if ($expected !== $actual) {
            throw new AssertionFailed(($message !== '' ? $message . "\n" : '') . 'Expected: ' . $this->dump($expected) . "\nActual:   " . $this->dump($actual));
        }
    }

    protected function assertTrue(mixed $actual, string $message = ''): void
    {
        $this->assertSame(true, $actual, $message);
    }

    protected function assertFalse(mixed $actual, string $message = ''): void
    {
        $this->assertSame(false, $actual, $message);
    }

    protected function assertNull(mixed $actual, string $message = ''): void
    {
        $this->assertSame(null, $actual, $message);
    }

    protected function assertCount(int $expected, array|\Countable $actual, string $message = ''): void
    {
        $this->assertSame($expected, count($actual), $message);
    }

    protected function assertContains(mixed $needle, array $haystack, string $message = ''): void
    {
        $this->assertions++;
        if (!in_array($needle, $haystack, true)) {
            throw new AssertionFailed(($message !== '' ? $message . "\n" : '') . 'Missing ' . $this->dump($needle) . ' in ' . $this->dump($haystack));
        }
    }

    protected function assertStringContains(string $needle, string $haystack, string $message = ''): void
    {
        $this->assertions++;
        if (!str_contains($haystack, $needle)) {
            throw new AssertionFailed(($message !== '' ? $message . "\n" : '') . 'Expected to find ' . $this->dump($needle) . ' in ' . $this->dump($haystack));
        }
    }

    protected function assertStringNotContains(string $needle, string $haystack, string $message = ''): void
    {
        $this->assertions++;
        if (str_contains($haystack, $needle)) {
            throw new AssertionFailed(($message !== '' ? $message . "\n" : '') . 'Did not expect to find ' . $this->dump($needle) . ' in ' . $this->dump($haystack));
        }
    }

    /** @param class-string<\Throwable> $class */
    protected function assertThrows(string $class, callable $work, ?string $messageContains = null): \Throwable
    {
        $this->assertions++;
        try {
            $work();
        } catch (\Throwable $e) {
            if (!($e instanceof $class)) {
                throw new AssertionFailed(sprintf('Expected %s, got %s: %s', $class, $e::class, $e->getMessage()));
            }
            if ($messageContains !== null && !str_contains($e->getMessage(), $messageContains)) {
                throw new AssertionFailed(sprintf('Exception message %s does not contain %s', $this->dump($e->getMessage()), $this->dump($messageContains)));
            }
            return $e;
        }
        throw new AssertionFailed(sprintf('Expected %s to be thrown, nothing was.', $class));
    }

    private function dump(mixed $value): string
    {
        $text = json_encode($value, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PARTIAL_OUTPUT_ON_ERROR);
        return is_string($text) ? (strlen($text) > 600 ? substr($text, 0, 600) . '...' : $text) : var_export($value, true);
    }
}
