<?php
declare(strict_types=1);

namespace KcPrintworks\AddressAutocomplete\Tests;

use KcPrintworks\AddressAutocomplete\Conflicts;

final class ConflictsTest extends TestCase
{
    public function testItFindsOtherScriptsThatLoadGoogleMapsAndKeepsOnlyTheHost(): void
    {
        $found = Conflicts::detect([
            'theme-map' => 'https://maps.googleapis.com/maps/api/js?key=OTHER_PLUGIN_SECRET_KEY&libraries=places',
            'old-plugin' => '//maps.google.com/maps/api/js?sensor=false',
            'jquery' => 'https://shop.example.test/wp-includes/js/jquery.js',
            'kcpw-aa' => 'https://maps.googleapis.com/ours',
            'kcpw-aa-admin' => 'https://maps.googleapis.com/ours-too',
            'lookalike' => 'https://maps.googleapis.com.evil.test/x.js',
        ]);
        $this->assertSame([['handle' => 'theme-map', 'host' => 'maps.googleapis.com'], ['handle' => 'old-plugin', 'host' => 'maps.google.com']], $found);
        $this->assertNotContains('OTHER_PLUGIN_SECRET_KEY', (string) json_encode($found), 'another plugin\'s key is never recorded');
    }

    public function testHandlesAreCleanedAndTheListIsCapped(): void
    {
        $scripts = [];
        for ($i = 0; $i < 30; $i++) {
            $scripts["h$i"] = 'https://maps.googleapis.com/x';
        }
        $this->assertSame(10, count(Conflicts::detect($scripts)));
        $this->assertSame('ab', Conflicts::detect(['a<b>' => 'https://maps.googleapis.com/x'])[0]['handle']);
        $this->assertSame([], Conflicts::detect([]));
    }

    public function testTheFooterReadsTheScriptsWordPressPrintedAndOnlyWritesWhenSomethingChanged(): void
    {
        global $wp_scripts;
        $wp_scripts = (object) [
            'done' => ['jquery', 'map-plugin'],
            'registered' => [
                'jquery' => (object) ['src' => '/wp-includes/jquery.js'],
                'map-plugin' => (object) ['src' => 'https://maps.googleapis.com/maps/api/js?key=SECRET'],
            ],
        ];
        $c = new Conflicts();
        $c->onFooter();
        $this->assertSame([['handle' => 'map-plugin', 'host' => 'maps.googleapis.com']], \WpStub::$transients['kcpw_aa_conflicts']);
        $this->assertNotContains('SECRET', (string) json_encode(\WpStub::$transients));
        \WpStub::$transients['kcpw_aa_conflicts'][] = ['handle' => 'sentinel', 'host' => 'maps.google.com'];
        $wp_scripts->done = ['jquery'];
        $c->onFooter();
        $this->assertSame([], \WpStub::$transients['kcpw_aa_conflicts'], 'cleared when the other script is gone');
        $wp_scripts = null;
        $c->onFooter();
        $this->assertTrue(true, 'no scripts object: nothing happens');
    }

    public function testStoredIgnoresJunk(): void
    {
        \WpStub::$transients['kcpw_aa_conflicts'] = [['handle' => 'a', 'host' => 'maps.googleapis.com'], 'junk', ['handle' => 5], ['handle' => 'b']];
        $this->assertSame([['handle' => 'a', 'host' => 'maps.googleapis.com']], Conflicts::stored());
        \WpStub::$transients['kcpw_aa_conflicts'] = 'junk';
        $this->assertSame([], Conflicts::stored());
    }
}
