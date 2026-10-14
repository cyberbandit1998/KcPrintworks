<?php
declare(strict_types=1);

namespace KcPrintworks\Core\Handoff;

/** The result of using a handoff token: a cart to build, or the reason there is none. */
final class Redemption
{
    public const INVALID_TOKEN = 'invalid_token';
    public const CHANGED = 'changed';

    /**
     * @param list<AddCall> $calls
     * @param list<array{index:int,issues:list<array{code:string,message:string,field?:string}>}> $problems
     */
    private function __construct(public readonly bool $ok, public readonly string $code, public readonly array $calls, public readonly array $problems)
    {
    }

    /** @param list<AddCall> $calls */
    public static function cart(array $calls): self
    {
        return new self(true, 'ok', $calls, []);
    }

    /** @param list<array{index:int,issues:list<array{code:string,message:string,field?:string}>}> $problems */
    public static function failed(string $code, array $problems = []): self
    {
        return new self(false, $code, [], $problems);
    }
}
