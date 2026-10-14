<?php
declare(strict_types=1);

namespace KcPrintworks\Core\Reviews;

final class ReviewValidation
{
    /**
     * @param array{productId:int,rating:int,name:string,email:string,review:string}|null $value
     * @param list<array{field:string,code:string,message:string}> $issues
     */
    public function __construct(
        public readonly bool $ok,
        public readonly ?array $value,
        public readonly array $issues,
    ) {
    }
}
