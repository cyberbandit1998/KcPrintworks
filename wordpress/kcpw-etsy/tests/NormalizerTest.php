<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Tests;

use KcPrintworks\Etsy\Etsy\Normalizer;
use KcPrintworks\Etsy\Model\Money;

final class NormalizerTest extends TestCase
{
    public function testNormalizesAListingWithVariantsImagesAndPersonalization(): void
    {
        $listing = (new Normalizer())->normalize(
            Fixtures::rawListing(111, ['is_personalizable' => true, 'personalization_is_required' => true, 'personalization_char_count_max' => 40, 'personalization_instructions' => 'Name / Emoji / Cable color']),
            Fixtures::rawInventory([
                [9001, 'TAG-RED-BLK', ['Tag Color' => 'Red', 'Text Color' => 'Black'], 899],
                [9002, 'TAG-BLU-WHT', ['Tag Color' => 'Blue', 'Text Color' => 'White'], 899, false],
            ]),
            Fixtures::rawImages([300, 100, 200]),
        );
        $this->assertSame(111, $listing->id);
        $this->assertSame([], $listing->warnings);
        $this->assertTrue($listing->madeToOrder());
        $this->assertSame(['Tag Color', 'Text Color'], $listing->variationProperties);
        $this->assertCount(2, $listing->variants);
        $this->assertSame('tag color=red|text color=black', $listing->variants[0]->optionsKey());
        $this->assertFalse($listing->variants[1]->enabled);
        $this->assertSame(899, $listing->basePrice()->toCents(), 'the base price ignores disabled variants');
        $this->assertSame(['TAG-RED-BLK', 'TAG-BLU-WHT'], $listing->skus());
        $this->assertSame([300, 100, 200], $listing->imageIds(), 'image order follows Etsy rank');
        $this->assertTrue($listing->personalization->enabled);
        $this->assertSame(40, $listing->personalization->maxChars);
        $this->assertSame('Name / Emoji / Cable color', $listing->personalization->instructions);
    }

    public function testMoneyUsesIntegerArithmeticOnly(): void
    {
        $this->assertSame(1524, (new Money(1524, 100, 'USD'))->toCents());
        $this->assertSame(1525, (new Money(15245, 1000, 'USD'))->toCents(), 'half a cent rounds up');
        $this->assertSame(1500, (new Money(15, 1, 'USD'))->toCents());
        $this->assertSame(-1525, (new Money(-15245, 1000, 'USD'))->toCents(), 'half away from zero');
        $this->assertNull(Money::fromEtsy(['amount' => 5]));
        $this->assertNull(Money::fromEtsy(['amount' => 5, 'divisor' => 0]));
    }

    public function testUnexpectedShapesBecomeWarningsNotCrashes(): void
    {
        $listing = (new Normalizer())->normalize(['listing_id' => 5, 'title' => 'x'], ['unexpected' => true], ['results' => [['no_id' => 1]]]);
        $this->assertSame(5, $listing->id);
        $joined = implode(' | ', $listing->warnings);
        $this->assertStringContains('missing "price"', $joined);
        $this->assertStringContains('inventory has no "products" list', $joined);
        $this->assertStringContains('an image has no listing_image_id', $joined);
        $this->assertNull($listing->basePrice());
    }

    public function testDeletedProductsAreMarked(): void
    {
        $inventory = Fixtures::rawInventory([[1, 'S', ['C' => 'x'], 100]]);
        $inventory['products'][0]['is_deleted'] = true;
        $listing = (new Normalizer())->normalize(Fixtures::rawListing(7), $inventory, Fixtures::rawImages([]));
        $this->assertTrue($listing->variants[0]->deleted);
        $this->assertSame(1524, $listing->basePrice()->toCents(), 'falls back to the listing price when every variant is deleted');
    }
}
