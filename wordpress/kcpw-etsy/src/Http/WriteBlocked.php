<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Http;

/** Thrown when something tries to send a request that the read-only phase does not allow. */
final class WriteBlocked extends \RuntimeException
{
}
