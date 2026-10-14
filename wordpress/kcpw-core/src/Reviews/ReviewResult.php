<?php
declare(strict_types=1);

namespace KcPrintworks\Core\Reviews;

final class ReviewResult
{
    public const RECEIVED = 'received';
    public const INVALID = 'invalid_request';
    public const CLOSED = 'reviews_closed';
    public const NOT_FOUND = 'product_not_found';
    public const VERIFICATION = 'verification_required';
    public const RATE_LIMITED = 'rate_limited';
    public const ERROR = 'server_error';

    /** @param list<array{field:string,code:string,message:string}> $problems */
    public function __construct(public readonly string $status, public readonly array $problems = [])
    {
    }

    public function ok(): bool
    {
        return $this->status === self::RECEIVED;
    }

    public function httpStatus(): int
    {
        return match ($this->status) {
            self::RECEIVED => 200,
            self::INVALID => 400,
            self::CLOSED, self::VERIFICATION => 403,
            self::NOT_FOUND => 404,
            self::RATE_LIMITED => 429,
            default => 500,
        };
    }

    /** @return array<string,mixed> */
    public function toArray(): array
    {
        $out = ['ok' => $this->ok(), 'status' => $this->status];
        if ($this->problems !== []) {
            $out['problems'] = $this->problems;
        }
        return $out;
    }
}
