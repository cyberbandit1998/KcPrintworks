<?php
declare(strict_types=1);

namespace KcPrintworks\Core\Handoff;

use KcPrintworks\Core\Cart\ResolvedLine;

final class HandoffResult
{
    public const OK = 'ok';
    public const INVALID = 'invalid_lines';
    public const CHANGED = 'changed';

    /** @param list<ResolvedLine> $lines */
    public function __construct(
        public readonly string $status,
        public readonly array $lines,
        public readonly int $subtotalCents,
        public readonly string $currency,
        public readonly ?string $redirectUrl = null,
        public readonly ?int $expiresAt = null,
    ) {
    }

    public function httpStatus(): int
    {
        return match ($this->status) {
            self::OK => 200,
            self::CHANGED => 409,
            default => 422,
        };
    }

    /** @return array<string,mixed> */
    public function toArray(): array
    {
        $lines = [];
        foreach ($this->lines as $index => $line) {
            $lines[] = [
                'index' => $index,
                'key' => $line->intent->key(),
                'productId' => $line->intent->productId,
                'variationId' => $line->variation?->id,
                'name' => $line->product?->name ?? 'Unavailable item',
                'variationLabel' => $line->variationLabel,
                'quantity' => $line->intent->quantity,
                'unitPrice' => $line->unitCents,
                'optionAdders' => $line->addersCents,
                'lineTotal' => $line->lineTotalCents(),
                'optionSummary' => $line->summary,
                'issues' => $line->issues,
            ];
        }
        $out = [
            'ok' => $this->status === self::OK,
            'status' => $this->status,
            'currency' => $this->currency,
            'subtotal' => $this->subtotalCents,
            'lines' => $lines,
        ];
        if ($this->redirectUrl !== null) {
            $out['redirectUrl'] = $this->redirectUrl;
            $out['expiresAt'] = $this->expiresAt;
        }
        return $out;
    }
}
