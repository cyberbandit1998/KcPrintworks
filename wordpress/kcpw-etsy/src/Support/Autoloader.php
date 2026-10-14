<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Support;

/** PSR-4 autoloader for the plugin's own classes (no Composer needed on the host). */
final class Autoloader
{
    private const PREFIX = 'KcPrintworks\\Etsy\\';

    public static function register(string $srcDir): void
    {
        spl_autoload_register(static function (string $class) use ($srcDir): void {
            if (strncmp($class, self::PREFIX, strlen(self::PREFIX)) !== 0) {
                return;
            }
            $relative = substr($class, strlen(self::PREFIX));
            $file = rtrim($srcDir, '/') . '/' . str_replace('\\', '/', $relative) . '.php';
            if (is_file($file)) {
                require $file;
            }
        });
    }
}
