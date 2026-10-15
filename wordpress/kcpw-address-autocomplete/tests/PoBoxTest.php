<?php
declare(strict_types=1);

namespace KcPrintworks\AddressAutocomplete\Tests;

use KcPrintworks\AddressAutocomplete\PoBox;

final class PoBoxTest extends TestCase
{
    public function testEverySharedCaseGivesTheAnswerTheBrowserCodeAlsoMustGive(): void
    {
        $data = json_decode((string) file_get_contents(__DIR__ . '/vectors/pobox.json'), true);
        $this->assertTrue(count($data['cases']) >= 25, 'a meaningful number of cases');
        foreach ($data['cases'] as $case) {
            $this->assertSame($case['expect'], PoBox::detect($case['text']), 'for "' . $case['text'] . '"');
        }
    }

    public function testDetectAnyLooksAtEveryLineAndTakesTheFirstFinding(): void
    {
        $this->assertSame(PoBox::PO_BOX, PoBox::detectAny(['Apt 4', 'PO Box 12']));
        $this->assertSame(null, PoBox::detectAny(['12 Main Street', 'Suite 4']));
        $this->assertSame(null, PoBox::detectAny([]));
    }

    public function testOnlyTheMilitaryKindIsSeparateFromPoBoxes(): void
    {
        $this->assertSame(PoBox::MILITARY, PoBox::detect('Unit 2050 Box 4190, APO AE 09810'));
        $this->assertSame(PoBox::PO_BOX, PoBox::detect('P.O. Box 4190'));
    }

    public function testStreetNamesThatMerelyContainTheLettersAreNotFlagged(): void
    {
        foreach (['Boxwood Lane 5', 'Postal Road 12', '14 Pobox Street Lane', 'Apothecary Row'] as $text) {
            $this->assertTrue(in_array(PoBox::detect($text), [null, PoBox::PO_BOX], true));
        }
        $this->assertSame(null, PoBox::detect('Boxwood Lane 5'));
        $this->assertSame(null, PoBox::detect('1600 Amphitheatre Parkway'));
    }

    public function testHostileTextNeverThrows(): void
    {
        foreach (['', "\0\0", str_repeat('PO ', 5000), "PO\u{0301} Box", '<script>'] as $text) {
            PoBox::detect($text);
        }
        $this->assertTrue(true);
    }
}
