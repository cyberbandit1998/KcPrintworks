<?php
declare(strict_types=1);

namespace KcPrintworks\AddressAutocomplete\Tests;

use KcPrintworks\AddressAutocomplete\Frontend;
use KcPrintworks\AddressAutocomplete\Settings;
use KcPrintworks\AddressAutocomplete\Shortcode;

final class ShortcodeTest extends TestCase
{
    private const KEY = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';

    private function shortcode(string $mode = 'live', bool $admin = false): Shortcode
    {
        \WpStub::$canManage = $admin;
        $settings = Settings::load(['mode' => $mode, 'browser_key' => self::KEY]);
        return new Shortcode(new Frontend('/x/kcpw-address-autocomplete/kcpw-address-autocomplete.php', '0.1.0', $settings, []));
    }

    private function config(): string
    {
        \WpStub::run('wp_footer');
        return \WpStub::$inline['kcpw-aa:before'] ?? '';
    }

    public function testItIsRegisteredAsAShortcode(): void
    {
        $this->shortcode()->register();
        $this->assertTrue(isset(\WpStub::$shortcodes['kcpw_address_autocomplete']));
    }

    public function testAttributesAreAllowListed(): void
    {
        $a = Shortcode::atts(['label' => '<b>Delivery</b> address', 'name' => 'Ship To!', 'fields' => 'rm -rf', 'mode' => 'both', 'required' => 'yes', 'class' => 'a b "x" c<d', 'placeholder' => str_repeat('p', 200)]);
        $this->assertSame('Delivery address', $a['label']);
        $this->assertSame('address', $a['name'], 'an invalid name falls back');
        $this->assertSame('hidden', $a['fields']);
        $this->assertSame('smart', $a['mode']);
        $this->assertTrue($a['required']);
        $this->assertSame('a b c', $a['class'], 'only plain class names survive: the quoted one and the tag fragment are gone');
        $this->assertSame(80, strlen($a['placeholder']));
        $this->assertSame('delivery_to', Shortcode::atts(['name' => 'Delivery_To'])['name']);
        $this->assertSame('Address', Shortcode::atts([])['label']);
        $this->assertFalse(Shortcode::atts([])['required']);
    }

    public function testWhenThePluginIsNotActiveItIsJustAnInputAndLoadsNothing(): void
    {
        foreach ([['off', true], ['preview', false]] as [$mode, $admin]) {
            \WpStub::reset();
            $html = $this->shortcode($mode, $admin)->render(['label' => 'Home']);
            $this->assertContains('<input type="text" class="kcpw-aa-sc__input" id="kcpw-aa-sc-1-address" name="address"', $html, $mode);
            $this->assertContains('<label for="kcpw-aa-sc-1-address">Home</label>', $html);
            $this->assertSame(0, count(\WpStub::$scripts), $mode . ': no script');
            $this->assertSame('', $this->config(), $mode . ': no configuration');
        }
    }

    public function testWithNoKeyItIsStillAPlainInput(): void
    {
        \WpStub::$canManage = true;
        $sc = new Shortcode(new Frontend('/x/f.php', '0.1.0', Settings::load(['mode' => 'live']), []));
        $html = $sc->render([]);
        $this->assertContains('name="address"', $html);
        $this->assertSame(0, count(\WpStub::$scripts));
    }

    public function testWhenActiveItQueuesTheScriptAndPrintsTheFormInTheFooterConfig(): void
    {
        $html = $this->shortcode()->render(['fields' => 'hidden']);
        $this->assertSame(1, count(\WpStub::$scripts));
        $this->assertSame('kcpw-aa', \WpStub::$scripts[0]['handle']);
        $js = $this->config();
        $this->assertContains('"id":"sc_1"', $js);
        $this->assertContains('"scope":"#kcpw-aa-sc-1"', $js);
        $this->assertContains('#kcpw-aa-sc-1-address', $js);
        $this->assertContains('#kcpw-aa-sc-1-city', $js);
        foreach (['address2', 'city', 'state', 'postcode', 'country'] as $part) {
            $this->assertContains('type="hidden" id="kcpw-aa-sc-1-' . $part . '"', $html, $part);
        }
        $this->assertContains('name="address_city"', $html);
        $this->assertContains('name="address_postcode"', $html);
    }

    public function testTwoShortcodesGetTheirOwnIdsAndForms(): void
    {
        $sc = $this->shortcode();
        $sc->render(['name' => 'home']);
        $sc->render(['name' => 'work', 'fields' => 'none']);
        $this->assertSame(1, count(\WpStub::$scripts), 'the script is queued once');
        $js = $this->config();
        $this->assertContains('"id":"sc_1"', $js);
        $this->assertContains('"id":"sc_2"', $js);
        $this->assertContains('#kcpw-aa-sc-2-address', $js);
        $this->assertSame(1, substr_count($js, 'window.KCPW_AA='), 'one configuration object');
    }

    public function testVisibleFieldsAreLabelledAndSingleModeOrNoneHasNoSubfields(): void
    {
        $visible = $this->shortcode()->render(['fields' => 'visible']);
        $this->assertContains('<label for="kcpw-aa-sc-1-city">City</label><input type="text" id="kcpw-aa-sc-1-city" name="address_city" autocomplete="off">', $visible);
        \WpStub::reset();
        $single = $this->shortcode()->render(['mode' => 'single']);
        $this->assertNotContains('address_city', $single);
        $this->assertContains('"mode":"single"', $this->config());
        \WpStub::reset();
        $none = $this->shortcode()->render(['fields' => 'none']);
        $this->assertNotContains('address_city', $none);
    }

    public function testEverythingPrintedIsEscaped(): void
    {
        $html = $this->shortcode('off')->render(['label' => '"><script>alert(1)</script>', 'placeholder' => '"onfocus="alert(1)', 'class' => 'ok']);
        $this->assertNotContains('<script', $html);
        $this->assertNotContains('"onfocus=', $html);
        $this->assertContains('placeholder="&quot;onfocus=&quot;alert(1)"', $html);
    }

    public function testRequiredAndPlaceholderAreOptional(): void
    {
        $html = $this->shortcode('off')->render(['required' => 'yes', 'placeholder' => 'Start typing']);
        $this->assertContains(' placeholder="Start typing" required>', $html);
        $this->assertNotContains(' required', $this->shortcode('off')->render([]));
    }

    public function testItNeverRunsWhilePickingFields(): void
    {
        $_GET['kcpw_aa_pick'] = 'nonce-kcpw_aa_pick';
        \WpStub::$canManage = true;
        $picker = new \KcPrintworks\AddressAutocomplete\Picker('/x/f.php', '0.1.0');
        $picker->maybeActivate();
        $this->assertTrue(\KcPrintworks\AddressAutocomplete\Picker::active());
        $html = $this->shortcode('live', true)->render([]);
        $this->assertContains('name="address"', $html);
        $this->assertSame(0, count(\WpStub::$scripts), 'the autocomplete steps aside while an administrator picks fields');
    }
}
