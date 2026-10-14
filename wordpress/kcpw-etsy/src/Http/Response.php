<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Http;

final class Response
{
    /** @var array<string,string> lower-cased header name => value */
    public readonly array $headers;

    /** @param array<string,string> $headers */
    public function __construct(public readonly int $status, array $headers, public readonly string $body)
    {
        $lower = [];
        foreach ($headers as $name => $value) {
            $lower[strtolower((string) $name)] = is_array($value) ? implode(', ', $value) : (string) $value;
        }
        $this->headers = $lower;
    }

    public function header(string $name): ?string
    {
        return $this->headers[strtolower($name)] ?? null;
    }

    public function ok(): bool
    {
        return $this->status >= 200 && $this->status < 300;
    }

    /** @return array<mixed> */
    public function json(): array
    {
        $decoded = json_decode($this->body, true);
        if (!is_array($decoded)) {
            throw new \RuntimeException('Response body is not a JSON object or array.');
        }
        return $decoded;
    }
}
