<?php
declare(strict_types=1);

namespace KcPrintworks\AddressAutocomplete\Tests;

use KcPrintworks\AddressAutocomplete\FormConfig;
use KcPrintworks\AddressAutocomplete\Frontend;
use KcPrintworks\AddressAutocomplete\Settings;

final class FrontendTest extends TestCase
{
    private const KEY = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';
    private const SERVER_KEY = 'ServerKeyServerKeyServerKey0123456789';

    private function frontend(string $mode = 'live', array $override = [], ?array $forms = null): Frontend
    {
        $settings = Settings::load($override + ['mode' => $mode, 'browser_key' => self::KEY, 'server_key' => self::SERVER_KEY]);
        $forms ??= FormConfig::sanitizeList([FormConfig::blank('woo_block')]);
        return new Frontend('/x/kcpw-address-autocomplete/kcpw-address-autocomplete.php', '0.1.0', $settings, $forms);
    }

    private function onCheckout(): void
    {
        \WpStub::$isCheckout = true;
        \WpStub::$requestUri = '/checkout/';
    }

    /** Runs the page: the script is queued on wp_enqueue_scripts and the configuration is printed in the footer. */
    private function render(Frontend $f): void
    {
        $f->enqueue();
        \WpStub::run('wp_footer');
    }

    public function testNothingLoadsWhenTheModeIsOffOrThereIsNoKey(): void
    {
        $this->onCheckout();
        $this->render($this->frontend('off'));
        $this->assertSame(0, count(\WpStub::$scripts));
        $this->render($this->frontend('live', ['browser_key' => '']));
        $this->assertSame(0, count(\WpStub::$scripts));
    }

    public function testPreviewIsForAdministratorsOnly(): void
    {
        $this->onCheckout();
        $this->render($this->frontend('preview'));
        $this->assertSame(0, count(\WpStub::$scripts), 'a customer gets nothing in preview mode');
        \WpStub::$canManage = true;
        $this->render($this->frontend('preview'));
        $this->assertSame(1, count(\WpStub::$scripts));
        $this->assertContains('"preview":true', \WpStub::$inline['kcpw-aa:before']);
        $this->assertContains('"admin":true', \WpStub::$inline['kcpw-aa:before']);
    }

    public function testLiveGivesCustomersTheScriptWithNoAdminFlags(): void
    {
        $this->onCheckout();
        $this->render($this->frontend('live'));
        $this->assertSame(1, count(\WpStub::$scripts));
        $this->assertSame(1, count(\WpStub::$styles));
        $this->assertContains('"preview":false', \WpStub::$inline['kcpw-aa:before']);
        $this->assertContains('"admin":false', \WpStub::$inline['kcpw-aa:before']);
    }

    public function testOnlyPagesThatMatchAFormLoadAnything(): void
    {
        foreach ([['/cart/', 11], ['/shop/', 12], ['/blog/a-post/', 13], ['/', 0]] as [$uri, $id]) {
            \WpStub::reset();
            \WpStub::$requestUri = $_SERVER['REQUEST_URI'] = $uri;
            \WpStub::$queriedId = $id;
            $this->render($this->frontend('live'));
            $this->assertSame(0, count(\WpStub::$scripts), $uri);
        }
        \WpStub::reset();
        \WpStub::$isCheckout = true;
        \WpStub::$isOrderReceived = true;
        $this->render($this->frontend('live'));
        $this->assertSame(0, count(\WpStub::$scripts), 'not on the order-received page');
    }

    public function testAdminAndAjaxRequestsLoadNothing(): void
    {
        $this->onCheckout();
        \WpStub::$isAdmin = true;
        $this->render($this->frontend('live'));
        $this->assertSame(0, count(\WpStub::$scripts));
        \WpStub::$isAdmin = false;
        \WpStub::$ajax = true;
        $this->render($this->frontend('live'));
        $this->assertSame(0, count(\WpStub::$scripts));
    }

    public function testTheScriptIsDeferredAndAfterTheBlockOwnScripts(): void
    {
        $this->onCheckout();
        $this->render($this->frontend('live'));
        $script = \WpStub::$scripts[0];
        $this->assertSame('kcpw-aa', $script['handle']);
        $this->assertSame(['in_footer' => true, 'strategy' => 'defer'], $script['args']);
        $this->assertContains('assets/js/kcpw-aa.js', $script['src']);
        $this->assertSame('0.1.0', $script['ver']);
    }

    public function testTheConfigHoldsThePublicKeyAndNeverTheServerKeyOrAnythingPersonal(): void
    {
        $this->onCheckout();
        $this->render($this->frontend('live'));
        $js = \WpStub::$inline['kcpw-aa:before'];
        $this->assertContains(self::KEY, $js, 'the browser key is public by design');
        $this->assertNotContains(self::SERVER_KEY, $js);
        $this->assertNotContains('server_key', $js);
        $this->assertNotContains('nonce', strtolower($js));
        $this->assertContains('window.KCPW_AA=', $js);
        $this->assertContains('#shipping-address_1', $js);
    }

    public function testTheJsonCannotBreakOutOfTheScriptBlockEvenIfSanitizingWereBypassed(): void
    {
        $this->onCheckout();
        // Handed to Frontend directly, NOT through FormConfig::sanitize, so this proves the output encoding on its own.
        $form = FormConfig::blank('woo_block');
        $form['groups'][0]['label'] = '</script><script>alert(1)</script> & \'quoted\' "double"';
        $form['groups'][0]['fields']['city'] = '#a[title="</script>&"]';
        $this->render($this->frontend('live', [], [$form]));
        $js = \WpStub::$inline['kcpw-aa:before'];
        $this->assertNotContains('</script>', $js);
        $this->assertNotContains('<', $js);
        $this->assertNotContains('&', $js);
        $this->assertNotContains("'", $js);
        $this->assertContains('\\u003C/script\\u003E', $js, 'the angle brackets are written as unicode escapes');
    }

    public function testConfigCarriesTheSettingsTheScriptNeeds(): void
    {
        $this->onCheckout();
        $f = $this->frontend('live', ['countries' => ['US', 'CA'], 'min_chars' => 4, 'debounce_ms' => 400, 'max_requests' => 9, 'theme' => 'dark']);
        $c = $f->buildConfig(FormConfig::sanitizeList([FormConfig::blank('woo_block')]), false);
        $this->assertSame(self::KEY, $c['key']);
        $this->assertSame(4, $c['minChars']);
        $this->assertSame(400, $c['debounce']);
        $this->assertSame(9, $c['maxRequests']);
        $this->assertSame('dark', $c['style']['theme']);
        $this->assertSame(['US', 'CA'], $c['forms'][0]['countries']);
        $this->assertSame('https://shop.example.test/wp-json/kcpw-aa/v1/usage', $c['rest']['usage']);
        $this->assertSame('Powered by Google', $c['i18n']['attribution']);
        $this->assertSame([], $c['modules'], 'no module file is loaded unless switched on');
    }

    public function testLanguageFollowsTheSiteUnlessSet(): void
    {
        $forms = FormConfig::sanitizeList([FormConfig::blank('woo_block')]);
        \WpStub::$locale = 'pt_BR';
        $this->assertSame('pt-BR', $this->frontend('live')->buildConfig($forms, false)['language']);
        \WpStub::$locale = 'en_US';
        $this->assertSame('en-US', $this->frontend('live')->buildConfig($forms, false)['language']);
        $this->assertSame('fr', $this->frontend('live', ['language' => 'fr'])->buildConfig($forms, false)['language']);
    }

    public function testTheContextReadsTheRequestPathAndWooCommerceState(): void
    {
        $_SERVER['REQUEST_URI'] = '/contact/?utm=1';
        \WpStub::$queriedId = 7;
        \WpStub::$isAccount = true;
        \WpStub::$isEditAddress = true;
        $c = $this->frontend()->context();
        $this->assertSame('/contact/', $c['path']);
        $this->assertSame(7, $c['postId']);
        $this->assertTrue($c['isAccountAddress']);
        $this->assertFalse($c['isCheckout']);
    }

    public function testTheAttributionAndEverySentenceComeFromTranslatableStrings(): void
    {
        $s = Frontend::strings();
        foreach (['attribution', 'listLabel', 'count', 'noResults', 'unavailable', 'limit', 'loading', 'placeFailed', 'filled', 'unit', 'preview', 'previewDismiss', 'problem'] as $key) {
            $this->assertTrue(isset($s[$key]) && $s[$key] !== '', $key);
        }
        $this->assertContains('%d', $s['count']);
    }

    public function testTheServerKeyIsNeverPrintedAndTheRestNonceIsForAdministratorsOnly(): void
    {
        $this->onCheckout();
        $this->render($this->frontend('live', ['modules' => ['validation' => true]]));
        $json = \WpStub::$inline['kcpw-aa:before'];
        $this->assertNotContains(self::SERVER_KEY, $json);
        $this->assertNotContains('nonce', $json, 'a customer\'s page holds no nonce');
        $this->assertContains('kcpw-aa/v1/validate', $json);

        \WpStub::reset();
        $this->onCheckout();
        \WpStub::$canManage = true;
        $this->render($this->frontend('preview', ['modules' => ['validation' => true]]));
        $this->assertContains('"nonce":"nonce-wp_rest"', \WpStub::$inline['kcpw-aa:before']);
    }

    public function testOnlyTheRoutesThatExistAreListed(): void
    {
        $this->onCheckout();
        $this->render($this->frontend('live', ['server_key' => '', 'modules' => ['validation' => true]]));
        $json = \WpStub::$inline['kcpw-aa:before'];
        $this->assertNotContains('kcpw-aa/v1/validate', $json, 'no server key, no address check');
        $this->assertNotContains('kcpw-aa/v1/hint', $json);
        $this->assertNotContains('checkout-start', $json);
        $this->assertContains('"hint":false', $json);
        $this->assertContains('"countCheckouts":false', $json);

        \WpStub::reset();
        $this->onCheckout();
        $this->render($this->frontend('live', ['optins' => ['ip' => ['enabled' => true], 'abandonment' => ['enabled' => true]]]));
        $json = \WpStub::$inline['kcpw-aa:before'];
        $this->assertContains('kcpw-aa/v1/hint', $json);
        $this->assertContains('"hint":true', $json);
        $this->assertContains('"countCheckouts":true', $json);
    }

    public function testTheAddressCheckFileIsNotOfferedWithoutAServerKey(): void
    {
        $forms = FormConfig::sanitizeList([FormConfig::blank('woo_block')]);
        $real = dirname(__DIR__) . '/kcpw-address-autocomplete.php';
        $make = static fn (array $override): Frontend => new Frontend($real, '0.1.0', Settings::load($override + ['mode' => 'live', 'browser_key' => self::KEY, 'modules' => ['validation' => true, 'pobox' => true]]), $forms);
        $with = $make(['server_key' => self::SERVER_KEY])->moduleUrls($forms);
        $without = $make(['server_key' => ''])->moduleUrls($forms);
        $this->assertTrue(isset($with['validation']), 'with a key the file is offered');
        $this->assertContains('kcpw-aa-validate.js?ver=0.1.0', $with['validation']);
        $this->assertFalse(isset($without['validation']), 'without a key it is not');
        $this->assertTrue(isset($without['pobox']), 'the others are unaffected');
        $this->assertFalse(isset($without['gps']), 'a feature that is off is never offered');
    }
}
