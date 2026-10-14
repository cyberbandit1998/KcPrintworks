<?php
declare(strict_types=1);

namespace KcPrintworks\Core\Options;

final class OptionValidation
{
    /**
     * @param array<string,string|bool> $values   normalized values by field id (only fields that were filled in)
     * @param list<array{fieldId:string,code:string,message:string}> $issues
     */
    public function __construct(public readonly bool $ok, public readonly array $values, public readonly array $issues)
    {
    }
}
