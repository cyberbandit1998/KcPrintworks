<?php
declare(strict_types=1);

namespace KcPrintworks\Core\Options;

/** A personalization schema that does not follow the contract (see packages/contracts/src/options.ts). */
final class SchemaError extends \InvalidArgumentException
{
}
