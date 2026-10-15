<?php
declare(strict_types=1);

namespace KcPrintworks\Quotes\Upload;

/** One picture that passed inspection: a safe display name, its real type (from its bytes, not its name), and the bytes. */
final class UploadedImage
{
    public function __construct(
        public readonly string $name,
        public readonly string $mime,
        public readonly string $bytes,
        public readonly int $width,
        public readonly int $height,
    ) {
    }

    public function with(string $mime, string $bytes, int $width, int $height): self
    {
        return new self($this->name, $mime, $bytes, $width, $height);
    }

    public function extension(): string
    {
        return ImagePolicy::EXTENSIONS[$this->mime] ?? 'bin';
    }
}
