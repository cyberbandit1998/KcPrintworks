<?php
declare(strict_types=1);

namespace KcPrintworks\Quotes\Domain;

/** The verdict on a request or an approval: the cleaned values, or the problems (field, code, message), never both. */
final class QuoteValidation
{
    /**
     * @param array<string,mixed>|null $value
     * @param list<array{field:string,code:string,message:string}> $issues
     */
    public function __construct(
        public readonly bool $ok,
        public readonly ?array $value,
        public readonly array $issues,
    ) {
    }
}
