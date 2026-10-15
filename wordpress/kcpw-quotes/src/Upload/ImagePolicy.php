<?php
declare(strict_types=1);

namespace KcPrintworks\Quotes\Upload;

/**
 * What the shop accepts as a reference picture, decided from the bytes and never from the name or the claimed type: a real JPEG, PNG,
 * WebP or GIF, a few of them, small in bytes and in pixels. The storefront has already checked all of this and makes photos smaller; this
 * is the check that counts, because anyone can call the endpoint with anything. No WordPress calls.
 */
final class ImagePolicy
{
    public const MAX_FILES = 4;
    public const MAX_FILE_BYTES = 2_621_440;
    public const MAX_TOTAL_BYTES = 5_242_880;
    /** Decoding a picture needs about 4 bytes per pixel of memory: this keeps one decode near 50 MB. */
    public const MAX_PIXELS = 12_000_000;
    public const MAX_SIDE = 8000;

    public const EXTENSIONS = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp', 'image/gif' => 'gif'];

    /** The real type from the first bytes, or null when it is none of the four. */
    public static function detect(string $bytes): ?string
    {
        if (strncmp($bytes, "\xFF\xD8\xFF", 3) === 0) {
            return 'image/jpeg';
        }
        if (strncmp($bytes, "\x89PNG\r\n\x1a\n", 8) === 0) {
            return 'image/png';
        }
        if (strncmp($bytes, 'GIF87a', 6) === 0 || strncmp($bytes, 'GIF89a', 6) === 0) {
            return 'image/gif';
        }
        if (strlen($bytes) >= 12 && strncmp($bytes, 'RIFF', 4) === 0 && substr($bytes, 8, 4) === 'WEBP') {
            return 'image/webp';
        }
        return null;
    }

    /** A name that is safe to show and to put in an email: no path, no control characters, plain characters only, at most 60 long. */
    public static function displayName(string $original, string $mime): string
    {
        $base = $original;
        if (class_exists(\Normalizer::class)) {
            $base = \Normalizer::normalize($base, \Normalizer::FORM_KD) ?: $base;
        }
        $base = (string) preg_replace('/\p{M}+/u', '', $base);
        $base = (string) preg_replace('/\p{C}+/u', '', $base);
        $parts = preg_split('#[\\\\/]#', $base) ?: [''];
        $base = (string) end($parts);
        $base = (string) preg_replace('/\.[A-Za-z0-9]{1,6}$/', '', $base);
        $base = (string) preg_replace('/[^A-Za-z0-9 ._()-]+/', ' ', $base);
        $base = (string) preg_replace('/\s+/', ' ', $base);
        $base = (string) preg_replace('/^[. -]+|[. -]+$/', '', $base);
        $base = trim(substr($base, 0, 50));
        return ($base === '' ? 'reference' : $base) . '.' . (self::EXTENSIONS[$mime] ?? 'bin');
    }

    /**
     * @param mixed $files the decoded JSON list of {name, type, data} (data is base64)
     * @return array{ok:true,images:list<UploadedImage>}|array{ok:false,reason:string}
     */
    public static function inspect(mixed $files): array
    {
        if ($files === null || $files === []) {
            return ['ok' => true, 'images' => []];
        }
        if (!is_array($files) || !array_is_list($files)) {
            return ['ok' => false, 'reason' => 'The pictures are not in the expected form.'];
        }
        if (count($files) > self::MAX_FILES) {
            return ['ok' => false, 'reason' => 'At most ' . self::MAX_FILES . ' pictures can be sent.'];
        }
        $images = [];
        $total = 0;
        foreach ($files as $file) {
            if (!($file instanceof \stdClass)) {
                return ['ok' => false, 'reason' => 'A picture is not in the expected form.'];
            }
            $extra = array_diff(array_keys(get_object_vars($file)), ['name', 'type', 'data']);
            if ($extra !== [] || !is_string($file->name ?? null) || !is_string($file->type ?? null) || !is_string($file->data ?? null)) {
                return ['ok' => false, 'reason' => 'A picture is not in the expected form.'];
            }
            // Cheap checks before decoding: base64 is 4/3 the size of its bytes.
            if (strlen($file->data) > (int) ceil(self::MAX_FILE_BYTES * 4 / 3) + 8) {
                return ['ok' => false, 'reason' => 'A picture is too large.'];
            }
            $bytes = base64_decode($file->data, true);
            if ($bytes === false || $bytes === '') {
                return ['ok' => false, 'reason' => 'A picture could not be read.'];
            }
            if (strlen($bytes) > self::MAX_FILE_BYTES) {
                return ['ok' => false, 'reason' => 'A picture is too large.'];
            }
            $total += strlen($bytes);
            if ($total > self::MAX_TOTAL_BYTES) {
                return ['ok' => false, 'reason' => 'The pictures together are too large.'];
            }
            $mime = self::detect($bytes);
            if ($mime === null || $mime !== $file->type) {
                return ['ok' => false, 'reason' => 'A file is not the kind of picture it says it is.'];
            }
            $info = @getimagesizefromstring($bytes);
            if ($info === false || !isset($info[0], $info[1]) || $info[0] < 1 || $info[1] < 1) {
                return ['ok' => false, 'reason' => 'A picture could not be read.'];
            }
            if ($info[0] > self::MAX_SIDE || $info[1] > self::MAX_SIDE || $info[0] * $info[1] > self::MAX_PIXELS) {
                return ['ok' => false, 'reason' => 'A picture has too many pixels. Please send a smaller one.'];
            }
            if (($info['mime'] ?? '') !== $mime) {
                return ['ok' => false, 'reason' => 'A file is not the kind of picture it says it is.'];
            }
            $images[] = new UploadedImage(self::displayName($file->name, $mime), $mime, $bytes, (int) $info[0], (int) $info[1]);
        }
        return ['ok' => true, 'images' => $images];
    }
}
