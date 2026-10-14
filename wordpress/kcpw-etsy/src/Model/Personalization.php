<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Model;

/** Etsy's personalization settings: one free-text box with instructions (To verify field names on the first run). */
final class Personalization
{
    public function __construct(
        public readonly bool $enabled,
        public readonly bool $required,
        public readonly ?int $maxChars,
        public readonly string $instructions,
    ) {
    }
}
