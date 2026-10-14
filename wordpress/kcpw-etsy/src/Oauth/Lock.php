<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Oauth;

/** Single-flight guard so two jobs never refresh the same rotating refresh token at once. */
interface Lock
{
    /** @param callable():mixed $work */
    public function synchronized(string $name, callable $work): mixed;
}
