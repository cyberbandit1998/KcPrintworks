<?php
declare(strict_types=1);

/**
 * Runs every tests/*Test.php: `php wordpress/kcpw-address-autocomplete/tests/run.php [filter]`. No dependencies. Exits non-zero on failure.
 */

error_reporting(E_ALL);
set_error_handler(static function (int $no, string $message, string $file, int $line): bool {
    throw new ErrorException($message, 0, $no, $file, $line);
});

require_once __DIR__ . '/wp-stubs.php';
foreach (['Settings', 'Presets', 'FormConfig', 'PageMatcher', 'Usage', 'RateLimiter', 'Frontend', 'Rest', 'Admin', 'Plugin'] as $class) {
    require_once dirname(__DIR__) . '/src/' . $class . '.php';
}
require_once __DIR__ . '/TestCase.php';

$filter = $argv[1] ?? '';
$passed = $failed = 0;
$assertions = 0;
$failures = [];

foreach (glob(__DIR__ . '/*Test.php') ?: [] as $file) {
    require_once $file;
    $class = 'KcPrintworks\\AddressAutocomplete\\Tests\\' . basename($file, '.php');
    $reflection = new ReflectionClass($class);
    foreach ($reflection->getMethods(ReflectionMethod::IS_PUBLIC) as $method) {
        if (!str_starts_with($method->getName(), 'test')) {
            continue;
        }
        $label = $reflection->getShortName() . '::' . $method->getName();
        if ($filter !== '' && stripos($label, $filter) === false) {
            continue;
        }
        WpStub::reset();
        $case = new $class();
        try {
            $method->invoke($case);
            $passed++;
        } catch (Throwable $e) {
            $failed++;
            $failures[] = $label . "\n  " . str_replace("\n", "\n  ", $e->getMessage()) . "\n  at " . basename($e->getFile()) . ':' . $e->getLine();
        }
        $assertions += $case->assertions;
    }
}

foreach ($failures as $failure) {
    fwrite(STDERR, "FAIL $failure\n");
}
echo "$passed passed, $failed failed, $assertions assertions\n";
exit($failed === 0 ? 0 : 1);
