<?php
declare(strict_types=1);

namespace KcPrintworks\Quotes\Wp;

use KcPrintworks\Quotes\Upload\FileStore;

/**
 * Reference pictures on disk, in a folder the web server must not serve. Files have random 40-character names and NO extension, so even
 * if the folder were reachable a file would be neither guessable nor executable; they are only ever sent out by the dashboard's
 * signed-in file handler, with their stored type and "nosniff". A custom folder outside the web root (KCPW_QUOTES_UPLOAD_DIR) is best.
 */
final class WpFileStore implements FileStore
{
    public function __construct(private readonly string $dir)
    {
    }

    public static function forSite(): self
    {
        return new self(Config::uploadDir()['dir']);
    }

    public function dir(): string
    {
        return $this->dir;
    }

    private function path(string $storedName): string
    {
        if (preg_match('/^[0-9a-f]{40}$/D', $storedName) !== 1) {
            throw new \InvalidArgumentException('Not a stored file name.');
        }
        return $this->dir . '/' . $storedName;
    }

    /** Creates the folder and the files that tell common web servers to keep out. */
    public function prepare(): bool
    {
        if ($this->dir === '' || !str_starts_with($this->dir, '/')) {
            return false;
        }
        if (!is_dir($this->dir) && !wp_mkdir_p($this->dir)) {
            return false;
        }
        $guards = [
            '.htaccess' => "# Pictures sent with quote requests. Never serve them directly.\nOptions -Indexes\n<IfModule mod_authz_core.c>\nRequire all denied\n</IfModule>\n<IfModule !mod_authz_core.c>\nOrder allow,deny\nDeny from all\n</IfModule>\n",
            'index.html' => '',
            'web.config' => "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<configuration><system.webServer><authorization><deny users=\"*\" /></authorization></system.webServer></configuration>\n",
        ];
        foreach ($guards as $name => $content) {
            $file = $this->dir . '/' . $name;
            if (!is_file($file)) {
                @file_put_contents($file, $content);
            }
        }
        return is_writable($this->dir);
    }

    public function put(string $storedName, string $bytes): void
    {
        $path = $this->path($storedName);
        if (!$this->prepare()) {
            throw new \RuntimeException('The picture folder is not writable.');
        }
        $temp = $path . '.tmp';
        if (@file_put_contents($temp, $bytes, LOCK_EX) !== strlen($bytes)) {
            @unlink($temp);
            throw new \RuntimeException('The picture could not be written.');
        }
        @chmod($temp, 0640);
        if (!@rename($temp, $path)) {
            @unlink($temp);
            throw new \RuntimeException('The picture could not be saved.');
        }
    }

    public function read(string $storedName): ?string
    {
        $path = $this->path($storedName);
        $bytes = is_file($path) ? @file_get_contents($path) : false;
        return is_string($bytes) ? $bytes : null;
    }

    public function delete(string $storedName): void
    {
        $path = $this->path($storedName);
        if (is_file($path)) {
            @unlink($path);
        }
    }
}
