<?php
declare(strict_types=1);

namespace KcPrintworks\Quotes\Upload;

/** Where the pictures' bytes live. Names are 40 hex characters chosen by the plugin; nothing a visitor typed is ever part of a path. */
interface FileStore
{
    /** @throws \RuntimeException when the bytes could not be stored */
    public function put(string $storedName, string $bytes): void;

    public function read(string $storedName): ?string;

    public function delete(string $storedName): void;
}
