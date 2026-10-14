<?php
declare(strict_types=1);

/**
 * Runs every tests/*Test.php: `php wordpress/kcpw-etsy/tests/run.php [filter]`.
 * Exits non-zero on any failure. No dependencies, so it also runs in CI and on the host.
 */

error_reporting(E_ALL);
set_error_handler(static function (int $no, string $message, string $file, int $line): bool {
    throw new ErrorException($message, 0, $no, $file, $line);
});

require dirname(__DIR__) . '/src/Support/Autoloader.php';
\KcPrintworks\Etsy\Support\Autoloader::register(dirname(__DIR__) . '/src');
spl_autoload_register(static function (string $class): void {
    $prefix = 'KcPrintworks\\Etsy\\Tests\\';
    if (strncmp($class, $prefix, strlen($prefix)) === 0) {
        $file = __DIR__ . '/' . str_replace('\\', '/', substr($class, strlen($prefix))) . '.php';
        if (is_file($file)) {
            require $file;
        }
    }
});

$filter = $argv[1] ?? '';
$passed = 0;
$failed = 0;
$skipped = 0;
$assertions = 0;
$failures = [];

foreach (glob(__DIR__ . '/*Test.php') ?: [] as $file) {
    $class = 'KcPrintworks\\Etsy\\Tests\\' . basename($file, '.php');
    require_once $file;
    $reflection = new ReflectionClass($class);
    foreach ($reflection->getMethods(ReflectionMethod::IS_PUBLIC) as $method) {
        if (!str_starts_with($method->getName(), 'test')) {
            continue;
        }
        $label = $reflection->getShortName() . '::' . $method->getName();
        if ($filter !== '' && stripos($label, $filter) === false) {
            continue;
        }
        $case = new $class();
        try {
            $method->invoke($case);
            $passed++;
        } catch (KcPrintworks\Etsy\Tests\Skipped $e) {
            $skipped++;
        } catch (Throwable $e) {
            $failed++;
            $failures[] = $label . "\n  " . str_replace("\n", "\n  ", $e->getMessage()) . "\n  at " . basename($e->getFile()) . ':' . $e->getLine();
        }
        $assertions += $case->assertions;
    }
}

foreach ($failures as $failure) {
    fwrite(STDERR, "FAIL " . $failure . "\n");
}
printf("%d passed, %d failed, %d skipped, %d assertions\n", $passed, $failed, $skipped, $assertions);
exit($failed === 0 ? 0 : 1);
