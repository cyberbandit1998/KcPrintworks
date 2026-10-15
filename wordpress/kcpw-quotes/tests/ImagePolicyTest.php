<?php
declare(strict_types=1);

namespace KcPrintworks\Quotes\Tests;

use KcPrintworks\Quotes\Support\Json;
use KcPrintworks\Quotes\Upload\GdImageSanitizer;
use KcPrintworks\Quotes\Upload\ImagePolicy;
use KcPrintworks\Quotes\Upload\PassThroughSanitizer;
use KcPrintworks\Quotes\Upload\UploadedImage;

final class ImagePolicyTest extends TestCase
{
    /** A real picture of the given type and size, made with GD. */
    public static function picture(string $mime = 'image/png', int $w = 8, int $h = 6): string
    {
        $im = imagecreatetruecolor($w, $h);
        imagefill($im, 0, 0, (int) imagecolorallocate($im, 255, 74, 36));
        ob_start();
        match ($mime) {
            'image/jpeg' => imagejpeg($im, null, 80),
            'image/gif' => imagegif($im),
            'image/webp' => imagewebp($im, null, 80),
            default => imagepng($im),
        };
        return (string) ob_get_clean();
    }

    /** @param list<array{name?:string,type?:string,data?:string}> $files */
    private function inspect(array $files): array
    {
        return ImagePolicy::inspect(Json::decode(json_encode($files, JSON_THROW_ON_ERROR)));
    }

    private function file(string $bytes, string $type, string $name = 'photo.png'): array
    {
        return ['name' => $name, 'type' => $type, 'data' => base64_encode($bytes)];
    }

    public function testRealPicturesOfTheFourTypesPass(): void
    {
        foreach (['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as $mime) {
            $result = $this->inspect([$this->file(self::picture($mime), $mime, 'a.' . $mime)]);
            $this->assertTrue($result['ok'], $mime);
            $this->assertSame($mime, $result['images'][0]->mime);
            $this->assertSame(8, $result['images'][0]->width);
            $this->assertSame(6, $result['images'][0]->height);
        }
    }

    public function testNoFilesIsFine(): void
    {
        $this->assertSame(['ok' => true, 'images' => []], ImagePolicy::inspect(null));
        $this->assertSame(['ok' => true, 'images' => []], ImagePolicy::inspect([]));
    }

    public function testTheNameAndTheClaimedTypeAreNeverTrustedOnlyTheBytesAre(): void
    {
        $php = "<?php system(\$_GET['c']); ?>";
        $this->assertFalse($this->inspect([$this->file($php, 'image/png', 'evil.php.png')])['ok'], 'a script labelled as a picture');
        $this->assertFalse($this->inspect([$this->file(self::picture('image/png'), 'image/jpeg')])['ok'], 'a PNG claiming to be a JPEG');
        $this->assertFalse($this->inspect([$this->file(self::picture('image/png'), 'application/pdf')])['ok'], 'a type that is not offered');
        $svg = '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>';
        $this->assertFalse($this->inspect([$this->file($svg, 'image/svg+xml', 'x.svg')])['ok'], 'svg can carry script');
        $this->assertFalse($this->inspect([$this->file('GIF89a' . $php, 'image/gif')])['ok'], 'a GIF header followed by script is not a readable picture');
    }

    public function testTooManyTooBigAndTooManyPixelsAreRefused(): void
    {
        $one = $this->file(self::picture(), 'image/png');
        $this->assertFalse($this->inspect(array_fill(0, 5, $one))['ok'], 'five pictures');
        $this->assertTrue($this->inspect(array_fill(0, 4, $one))['ok'], 'four pictures');

        $big = self::picture('image/png') . str_repeat("\0", ImagePolicy::MAX_FILE_BYTES);
        $this->assertFalse($this->inspect([$this->file($big, 'image/png')])['ok'], 'one file over the size limit');

        $almost = self::picture('image/png') . str_repeat("\0", ImagePolicy::MAX_FILE_BYTES - 200);
        $this->assertFalse($this->inspect(array_fill(0, 3, $this->file($almost, 'image/png')))['ok'], 'together over the limit');

        // A PNG header that CLAIMS 60000 x 60000 pixels (a decompression bomb) is refused from the header alone, before anything decodes it.
        $bomb = "\x89PNG\r\n\x1a\n" . pack('N', 13) . 'IHDR' . pack('NN', 60000, 60000) . "\x08\x06\x00\x00\x00" . pack('N', 0);
        $this->assertFalse($this->inspect([$this->file($bomb, 'image/png')])['ok'], 'a huge picture claim');
        $wide = self::picture('image/png', ImagePolicy::MAX_SIDE + 1, 1);
        $this->assertFalse($this->inspect([$this->file($wide, 'image/png')])['ok'], 'one side over the limit');
    }

    public function testMalformedListsAreRefused(): void
    {
        $this->assertFalse(ImagePolicy::inspect('nope')['ok']);
        $this->assertFalse(ImagePolicy::inspect(Json::decode('{"a":1}'))['ok'], 'an object is not a list');
        $this->assertFalse(ImagePolicy::inspect(Json::decode('["x"]'))['ok']);
        $this->assertFalse(ImagePolicy::inspect(Json::decode('[{"name":"a.png","type":"image/png","data":"!!!notbase64!!!"}]'))['ok']);
        $png = base64_encode(self::picture());
        $this->assertFalse(ImagePolicy::inspect(Json::decode('[{"name":"a.png","type":"image/png","data":"' . $png . '","path":"/etc/passwd"}]'))['ok'], 'an extra key');
        $this->assertFalse(ImagePolicy::inspect(Json::decode('[{"name":5,"type":"image/png","data":"' . $png . '"}]'))['ok']);
        $this->assertFalse(ImagePolicy::inspect(Json::decode('[{"name":"a.png","type":"image/png","data":""}]'))['ok']);
    }

    public function testDisplayNamesAreSafeToShowAndToEmail(): void
    {
        $this->assertSame('case photo (1).png', ImagePolicy::displayName('C:\\Users\\me\\Pictures\\case photo (1).PNG', 'image/png'));
        $this->assertSame('x.php.jpg', ImagePolicy::displayName("x\0.php.jpg", 'image/jpeg'));
        $this->assertSame('script.gif', ImagePolicy::displayName('<script>alert(1)</script>.gif', 'image/gif'));
        $this->assertSame('reference.webp', ImagePolicy::displayName('', 'image/webp'));
        $this->assertSame('Unicode Name.jpg', ImagePolicy::displayName('Ünïcode Ñame.jpeg', 'image/jpeg'));
        $this->assertSame('reference.png', ImagePolicy::displayName("..\n\r.", 'image/png'));
        $this->assertTrue(strlen(ImagePolicy::displayName(str_repeat('a', 500) . '.png', 'image/png')) <= 54);
        $name = ImagePolicy::displayName("evil\r\nBcc: attacker@example.com.png", 'image/png');
        $this->assertSame(0, preg_match('/[\r\n]/', $name), 'no line breaks, so a name cannot add an email header');
    }

    public function testGdRedrawsAPictureAndDropsWhatWasHiddenInsideIt(): void
    {
        if (!GdImageSanitizer::available()) {
            $this->skip('GD is not installed');
        }
        $secret = '<?php echo "pwned"; ?> HIDDEN-METADATA-MARKER';
        $original = self::picture('image/png') . $secret;
        $result = $this->inspect([$this->file($original, 'image/png')]);
        $this->assertTrue($result['ok'], 'a PNG with trailing data is still a picture');
        $clean = (new GdImageSanitizer())->sanitize($result['images'][0]);
        $this->assertTrue($clean !== null);
        $this->assertSame('image/png', $clean->mime);
        $this->assertStringNotContains('HIDDEN-METADATA-MARKER', $clean->bytes);
        $this->assertStringNotContains('<?php', $clean->bytes);
        $this->assertSame('image/png', ImagePolicy::detect($clean->bytes));

        // Same for a JPEG with a comment segment holding a script.
        $jpeg = self::picture('image/jpeg');
        $withComment = substr($jpeg, 0, 2) . "\xFF\xFE" . pack('n', strlen($secret) + 2) . $secret . substr($jpeg, 2);
        $r2 = $this->inspect([$this->file($withComment, 'image/jpeg')]);
        $this->assertTrue($r2['ok']);
        $c2 = (new GdImageSanitizer())->sanitize($r2['images'][0]);
        $this->assertTrue($c2 !== null);
        $this->assertStringNotContains('HIDDEN-METADATA-MARKER', $c2->bytes);
    }

    public function testAGifBecomesAPngAndACorruptPictureIsRefused(): void
    {
        if (!GdImageSanitizer::available()) {
            $this->skip('GD is not installed');
        }
        $gif = $this->inspect([$this->file(self::picture('image/gif'), 'image/gif', 'anim.gif')]);
        $clean = (new GdImageSanitizer())->sanitize($gif['images'][0]);
        $this->assertSame('image/png', $clean?->mime);
        $this->assertSame('anim.png', ImagePolicy::displayName('anim.gif', $clean->mime));

        $jpeg = self::picture('image/jpeg', 40, 40);
        $truncated = substr($jpeg, 0, 120);
        $r = $this->inspect([$this->file($truncated, 'image/jpeg')]);
        if ($r['ok']) {
            $this->assertNull((new GdImageSanitizer())->sanitize($r['images'][0]), 'a cut-off picture cannot be drawn again');
        } else {
            $this->assertTrue(true);
        }
    }

    public function testWithoutGdPicturesAreKeptButTheDashboardCanTellThem(): void
    {
        $sanitizer = new PassThroughSanitizer();
        $image = new UploadedImage('a.png', 'image/png', self::picture(), 8, 6);
        $this->assertFalse($sanitizer->redraws());
        $this->assertSame($image, $sanitizer->sanitize($image));
        $this->assertTrue((new GdImageSanitizer())->redraws());
    }
}
