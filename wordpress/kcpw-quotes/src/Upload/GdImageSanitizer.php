<?php
declare(strict_types=1);

namespace KcPrintworks\Quotes\Upload;

/** Re-draws pictures with PHP's GD: JPEG stays JPEG, PNG stays PNG, WebP stays WebP, a GIF becomes a PNG of its first frame. */
final class GdImageSanitizer implements ImageSanitizer
{
    public static function available(): bool
    {
        return function_exists('imagecreatefromstring') && function_exists('imagejpeg') && function_exists('imagepng');
    }

    public function redraws(): bool
    {
        return true;
    }

    public function sanitize(UploadedImage $image): ?UploadedImage
    {
        $source = @imagecreatefromstring($image->bytes);
        if ($source === false) {
            return null;
        }
        $width = imagesx($source);
        $height = imagesy($source);
        $out = null;
        $mime = $image->mime;
        ob_start();
        try {
            switch ($image->mime) {
                case 'image/jpeg':
                    // A JPEG has no transparency: flatten onto white (a decoded JPEG has none, but a mislabelled file might).
                    $flat = imagecreatetruecolor($width, $height);
                    if ($flat === false) {
                        return null;
                    }
                    imagefill($flat, 0, 0, (int) imagecolorallocate($flat, 255, 255, 255));
                    imagecopy($flat, $source, 0, 0, 0, 0, $width, $height);
                    imagejpeg($flat, null, 88);
                    break;
                case 'image/webp':
                    if (!function_exists('imagewebp')) {
                        return null;
                    }
                    imagepalettetotruecolor($source);
                    imagealphablending($source, false);
                    imagesavealpha($source, true);
                    imagewebp($source, null, 85);
                    break;
                default: // PNG, and the first frame of a GIF
                    imagealphablending($source, false);
                    imagesavealpha($source, true);
                    imagepng($source, null, 6);
                    $mime = 'image/png';
            }
        } finally {
            $out = (string) ob_get_clean();
        }
        if ($out === '' || ImagePolicy::detect($out) !== $mime) {
            return null;
        }
        return $image->with($mime, $out, $width, $height);
    }
}
