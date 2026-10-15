<?php
declare(strict_types=1);

namespace KcPrintworks\Quotes\Service;

final class IntakeResult
{
    public const RECEIVED = 'received';
    public const INVALID = 'invalid_request';
    public const INVALID_FILE = 'invalid_file';
    public const LIMITED = 'rate_limited';
    public const ERROR = 'server_error';

    /** @param list<array{field:string,code:string,message:string}> $problems */
    private function __construct(
        public readonly string $status,
        public readonly ?string $ref = null,
        public readonly array $problems = [],
        public readonly bool $duplicate = false,
    ) {
    }

    public static function received(string $ref, bool $duplicate = false): self
    {
        return new self(self::RECEIVED, $ref, [], $duplicate);
    }

    /** @param list<array{field:string,code:string,message:string}> $problems */
    public static function invalid(array $problems): self
    {
        return new self(self::INVALID, null, $problems);
    }

    public static function failed(string $status): self
    {
        return new self($status);
    }

    public function ok(): bool
    {
        return $this->status === self::RECEIVED;
    }

    public function httpStatus(): int
    {
        return match ($this->status) {
            self::RECEIVED => 200,
            self::INVALID, self::INVALID_FILE => 400,
            self::LIMITED => 429,
            default => 500,
        };
    }

    /** @return array<string,mixed> */
    public function toArray(): array
    {
        $out = ['ok' => $this->ok(), 'status' => $this->status];
        if ($this->ref !== null) {
            $out['ref'] = $this->ref;
        }
        if ($this->problems !== []) {
            $out['problems'] = $this->problems;
        }
        return $out;
    }
}
