<?php
declare(strict_types=1);

namespace KcPrintworks\AddressAutocomplete;

/**
 * The three-step setup: (1) the Google key, (2) which form to add, (3) how to start (Preview by default). Each step is its own small
 * form posting to the same handler with the same nonce, and each saves only what its own step asked for. Nothing in it can switch
 * the plugin on for customers except step 3's explicit "Live" choice, which is never the pre-selected one.
 */
final class Wizard
{
    public const STEPS = 3;

    public function __construct(private readonly Store $store)
    {
    }

    public function html(int $step): string
    {
        $step = max(1, min(self::STEPS, $step));
        $out = '<div class="wrap kcpw-aa-admin kcpw-aa-wizard"><h1>' . Html::h(__('Set up Address Autocomplete', 'kcpw-address-autocomplete')) . '</h1>';
        $out .= '<ol class="kcpw-aa-wizard-steps" aria-label="' . Html::a(__('Setup steps', 'kcpw-address-autocomplete')) . '">';
        foreach ([1 => __('Google key', 'kcpw-address-autocomplete'), 2 => __('Your form', 'kcpw-address-autocomplete'), 3 => __('Start safely', 'kcpw-address-autocomplete')] as $n => $label) {
            $out .= '<li' . ($n === $step ? ' aria-current="step" class="is-current"' : '') . '>' . Html::h($label) . '</li>';
        }
        $out .= '</ol>';
        $out .= '<form method="post" action="' . Html::a(admin_url('admin-post.php')) . '" class="kcpw-aa-card">';
        $out .= '<input type="hidden" name="action" value="kcpw_aa_wizard"><input type="hidden" name="step" value="' . $step . '">' . wp_nonce_field('kcpw_aa_wizard', '_wpnonce', true, false);
        $out .= match ($step) {
            2 => $this->stepForm(),
            3 => $this->stepMode(),
            default => $this->stepKey(),
        };
        $out .= '<p class="submit"><button type="submit" class="button button-primary">' . Html::h($step === self::STEPS ? __('Finish', 'kcpw-address-autocomplete') : __('Continue', 'kcpw-address-autocomplete')) . '</button> ';
        $out .= '<a class="button" href="' . Html::a(admin_url('admin.php?page=' . Admin::SLUG)) . '">' . Html::h(__('Skip the setup', 'kcpw-address-autocomplete')) . '</a></p></form></div>';
        return $out;
    }

    private function stepKey(): string
    {
        $s = $this->store->settings;
        $saved = (string) $this->store->effective()['browser_key'];
        $out = '<h2>' . Html::h(__('Step 1 of 3: your Google key', 'kcpw-address-autocomplete')) . '</h2>';
        $out .= '<p>' . Html::h(__('You need a Google Cloud project with billing on, the Maps JavaScript API and Places API (New) turned on, and a browser key restricted to your website. The Dashboard explains each of these. Paste the key here.', 'kcpw-address-autocomplete')) . '</p>';
        $out .= '<p><label for="kcpw-aa-browser-key">' . Html::h(__('Google browser key', 'kcpw-address-autocomplete')) . '</label><br>';
        $out .= '<input type="text" class="regular-text code" id="kcpw-aa-browser-key" name="w[browser_key]" value="" autocomplete="off" spellcheck="false" placeholder="' . Html::a($saved !== '' ? Settings::maskKey($saved) : __('Paste your key', 'kcpw-address-autocomplete')) . '"></p>';
        $out .= '<p><label for="kcpw-aa-countries">' . Html::h(__('Countries you ship to (optional, up to five codes)', 'kcpw-address-autocomplete')) . '</label><br>' . Html::text('w[countries]', 'kcpw-aa-countries', implode(', ', $s['countries']), 'regular-text', 'maxlength="40" placeholder="US, CA"') . '</p>';
        return $out;
    }

    private function stepForm(): string
    {
        $out = '<h2>' . Html::h(__('Step 2 of 3: which form?', 'kcpw-address-autocomplete')) . '</h2>';
        $out .= '<p>' . Html::h(__('Most shops start with the checkout. Other forms can be added later on the Forms screen, and the Visual Selector Tool lets you click the fields on any page.', 'kcpw-address-autocomplete')) . '</p>';
        $options = [];
        foreach (Presets::all() as $key => $preset) {
            $options[$key] = $preset['label'];
        }
        $out .= Html::radios('w[preset]', 'woo_block', $options, __('Which form?', 'kcpw-address-autocomplete'));
        return $out;
    }

    private function stepMode(): string
    {
        $out = '<h2>' . Html::h(__('Step 3 of 3: start safely', 'kcpw-address-autocomplete')) . '</h2>';
        $out .= '<p>' . Html::h(__('Preview shows address suggestions to logged-in administrators only. Open your checkout, try a few addresses, and switch to Live from the Dashboard when you are happy.', 'kcpw-address-autocomplete')) . '</p>';
        $out .= Html::radios('w[mode]', Settings::MODE_PREVIEW, [
            Settings::MODE_PREVIEW => __('Preview: administrators only (recommended)', 'kcpw-address-autocomplete'),
            Settings::MODE_OFF => __('Off for now', 'kcpw-address-autocomplete'),
            Settings::MODE_LIVE => __('Live: all visitors, right away', 'kcpw-address-autocomplete'),
        ], __('How to start', 'kcpw-address-autocomplete'));
        return $out;
    }

    /**
     * Saves one step and returns where to go next.
     *
     * @param array<string, mixed> $raw the posted `w` array
     */
    public function handle(int $step, array $raw): string
    {
        $base = admin_url('admin.php?page=' . Admin::SLUG);
        switch ($step) {
            case 1:
                $input = ['countries' => $raw['countries'] ?? ''];
                if (isset($raw['browser_key']) && is_string($raw['browser_key'])) {
                    $input['browser_key'] = $raw['browser_key'];
                }
                $this->store->saveSettings(Settings::applySection($this->store->settings, $input, 'general'));
                return $base . '&view=wizard&step=2';
            case 2:
                $preset = isset($raw['preset']) && is_string($raw['preset']) ? $raw['preset'] : '';
                if (!isset(Presets::all()[$preset])) {
                    return $base . '&view=wizard&step=2&kcpw_msg=error';
                }
                if ($preset === 'custom') {
                    // A custom form needs its fields picked first; the editor then comes back here.
                    return admin_url('admin.php?page=kcpw-aa-forms&new=custom');
                }
                if (count($this->store->forms) < FormConfig::MAX_FORMS && !$this->hasPreset($preset)) {
                    $this->store->saveForms(array_merge($this->store->forms, [FormConfig::blank($preset)]));
                }
                return $base . '&view=wizard&step=3';
            case 3:
                $mode = isset($raw['mode']) && is_string($raw['mode']) ? $raw['mode'] : Settings::MODE_PREVIEW;
                $settings = Settings::applySection($this->store->settings, ['mode' => $mode], 'general');
                $this->store->saveSettings(Settings::markWizardDone($settings));
                return $base . '&kcpw_msg=wizard_done';
        }
        return $base;
    }

    private function hasPreset(string $preset): bool
    {
        foreach ($this->store->forms as $form) {
            if (($form['preset'] ?? '') === $preset) {
                return true;
            }
        }
        return false;
    }
}
