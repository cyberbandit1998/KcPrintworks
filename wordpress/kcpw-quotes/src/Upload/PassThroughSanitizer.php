<?php
declare(strict_types=1);

namespace KcPrintworks\Quotes\Upload;

/** Used only when the server has no GD: the picture is kept as it is (it has passed ImagePolicy), and stored under a random name, with no extension, served only through a signed-in dashboard handler with nosniff. */
final class PassThroughSanitizer implements ImageSanitizer
{
    public function redraws(): bool
    {
        return false;
    }

    public function sanitize(UploadedImage $image): ?UploadedImage
    {
        return $image;
    }
}
