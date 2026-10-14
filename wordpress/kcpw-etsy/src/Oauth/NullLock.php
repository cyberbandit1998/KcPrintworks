<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Oauth;

final class NullLock implements Lock
{
    public function synchronized(string $name, callable $work): mixed
    {
        return $work();
    }
}
