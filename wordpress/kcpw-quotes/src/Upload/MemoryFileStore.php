<?php
declare(strict_types=1);

namespace KcPrintworks\Quotes\Upload;

final class MemoryFileStore implements FileStore
{
    /** @var array<string,string> */
    public array $files = [];
    public bool $failNextPut = false;

    public function put(string $storedName, string $bytes): void
    {
        if ($this->failNextPut) {
            $this->failNextPut = false;
            throw new \RuntimeException('disk full');
        }
        $this->files[$storedName] = $bytes;
    }

    public function read(string $storedName): ?string
    {
        return $this->files[$storedName] ?? null;
    }

    public function delete(string $storedName): void
    {
        unset($this->files[$storedName]);
    }
}
