<?php
declare(strict_types=1);

namespace KcPrintworks\Quotes\Upload;

/**
 * Makes a picture "just pixels": decoded and drawn again, so nothing else that was inside the file (hidden code appended after the
 * image, metadata with a location, a trailing archive) is kept. Null means the picture could not be decoded and is refused.
 */
interface ImageSanitizer
{
    public function sanitize(UploadedImage $image): ?UploadedImage;

    /** Whether pictures are really re-drawn (false = kept byte for byte after the checks; the dashboard says so). */
    public function redraws(): bool;
}
