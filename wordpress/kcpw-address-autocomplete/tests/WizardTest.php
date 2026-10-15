<?php
declare(strict_types=1);

namespace KcPrintworks\AddressAutocomplete\Tests;

use KcPrintworks\AddressAutocomplete\Settings;
use KcPrintworks\AddressAutocomplete\Store;
use KcPrintworks\AddressAutocomplete\Wizard;

final class WizardTest extends TestCase
{
    private const KEY = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';

    private function wizard(array $settings = [], array $forms = []): array
    {
        $store = new Store(Settings::load($settings), $forms);
        return [new Wizard($store), $store];
    }

    public function testEachStepShowsItsOwnFormWithTheNonceAndMarksTheCurrentStep(): void
    {
        [$w] = $this->wizard();
        $one = $w->html(1);
        $this->assertContains('Step 1 of 3', $one);
        $this->assertContains('name="w[browser_key]"', $one);
        $this->assertContains('nonce-for-kcpw_aa_wizard', $one);
        $this->assertContains('name="action" value="kcpw_aa_wizard"', $one);
        $this->assertContains('aria-current="step"', $one);
        $two = $w->html(2);
        $this->assertContains('Step 2 of 3', $two);
        $this->assertContains('name="w[preset]"', $two);
        $this->assertContains('value="woo_block" checked', $two, 'the checkout is pre-selected');
        $three = $w->html(3);
        $this->assertContains('Step 3 of 3', $three);
        $this->assertContains('value="preview" checked', $three, 'Preview is the pre-selected start');
        $this->assertNotContains('value="live" checked', $three);
        $this->assertContains('Skip the setup', $three);
        $this->assertContains('Step 1 of 3', $w->html(0), 'a bad step number shows the first');
        $this->assertContains('Step 3 of 3', $w->html(9));
    }

    public function testStepOneSavesTheKeyAndCountriesAndNothingElse(): void
    {
        [$w, $store] = $this->wizard(['mode' => 'off']);
        $next = $w->handle(1, ['browser_key' => self::KEY, 'countries' => 'us, ca', 'mode' => 'live']);
        $this->assertContains('view=wizard&step=2', $next);
        $this->assertSame(self::KEY, $store->settings['browser_key']);
        $this->assertSame(['US', 'CA'], $store->settings['countries']);
        $this->assertSame('off', $store->settings['mode'], 'step 1 cannot change the mode');
        [$w2, $store2] = $this->wizard(['browser_key' => self::KEY]);
        $w2->handle(1, ['browser_key' => '']);
        $this->assertSame(self::KEY, $store2->settings['browser_key'], 'leaving the key blank keeps the saved one');
    }

    public function testTheSavedKeyIsNotPrintedBack(): void
    {
        [$w] = $this->wizard(['browser_key' => self::KEY]);
        $html = $w->html(1);
        $this->assertNotContains(self::KEY, $html);
        $this->assertContains('6789', $html);
    }

    public function testStepTwoAddsThePresetOnceAndSendsACustomFormToTheEditor(): void
    {
        [$w, $store] = $this->wizard();
        $this->assertContains('step=3', $w->handle(2, ['preset' => 'woo_block']));
        $this->assertSame(1, count($store->forms));
        $this->assertSame('woo_block', $store->forms[0]['preset']);
        $w->handle(2, ['preset' => 'woo_block']);
        $this->assertSame(1, count($store->forms), 'running the step again does not add a second copy');
        $this->assertContains('page=kcpw-aa-forms&new=custom', $w->handle(2, ['preset' => 'custom']));
        $this->assertSame(1, count($store->forms), 'a custom form is made in the editor');
        $this->assertContains('kcpw_msg=error', $w->handle(2, ['preset' => 'rm -rf']));
        $this->assertContains('kcpw_msg=error', $w->handle(2, []));
    }

    public function testStepThreeNeverGoesLiveUnlessLiveWasChosen(): void
    {
        [$w, $store] = $this->wizard(['mode' => 'off']);
        $w->handle(3, []);
        $this->assertSame('preview', $store->settings['mode'], 'no choice means Preview');
        $this->assertTrue($store->settings['wizard_done']);
        $w->handle(3, ['mode' => 'banana']);
        $this->assertSame('preview', $store->settings['mode'], 'nonsense means the current mode stays');
        $w->handle(3, ['mode' => 'live']);
        $this->assertSame('live', $store->settings['mode']);
        $this->assertContains('kcpw_msg=wizard_done', $w->handle(3, ['mode' => 'preview']));
    }

    public function testAnUnknownStepGoesBackToTheDashboard(): void
    {
        [$w] = $this->wizard();
        $this->assertSame('https://shop.example.test/wp-admin/admin.php?page=kcpw-aa', $w->handle(7, []));
    }
}
