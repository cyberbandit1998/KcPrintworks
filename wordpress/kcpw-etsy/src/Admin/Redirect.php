<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Admin;

/** Thrown by test gateways in place of an actual redirect. */
final class Redirect extends \RuntimeException
{
    public function __construct(public readonly string $url)
    {
        parent::__construct('Redirect to ' . $url);
    }
}
