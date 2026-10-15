<?php
declare(strict_types=1);

namespace KcPrintworks\AddressAutocomplete;

/**
 * The plugin's saved state in one place: the settings and the list of forms. Every screen reads and writes through here, so a value
 * is always sanitized on the way in and the options are never autoloaded (the settings hold the Google key; neither option should be
 * read on every page of the site).
 */
final class Store
{
    /**
     * @param array<string, mixed> $settings
     * @param list<array<string, mixed>> $forms
     */
    public function __construct(public array $settings, public array $forms)
    {
    }

    public static function load(): self
    {
        return new self(
            Settings::load(get_option(Settings::OPTION, [])),
            FormConfig::sanitizeList(get_option(FormConfig::OPTION, [])),
        );
    }

    /** @param array<string, mixed> $settings */
    public function saveSettings(array $settings): void
    {
        $this->settings = Settings::load($settings);
        update_option(Settings::OPTION, $this->settings, false);
    }

    /** @param list<array<string, mixed>> $forms */
    public function saveForms(array $forms): void
    {
        $this->forms = FormConfig::sanitizeList(array_values($forms));
        update_option(FormConfig::OPTION, $this->forms, false);
    }

    /**
     * The settings as the rest of the plugin should read them: a key set as a constant in wp-config.php wins over the saved one.
     * For reading only; never saved back.
     *
     * @return array<string, mixed>
     */
    public function effective(): array
    {
        return Settings::effective(
            $this->settings,
            defined('KCPW_AA_BROWSER_KEY') ? constant('KCPW_AA_BROWSER_KEY') : null,
            defined('KCPW_AA_SERVER_KEY') ? constant('KCPW_AA_SERVER_KEY') : null,
        );
    }

    /** @return array<string, mixed>|null */
    public function form(string $id): ?array
    {
        foreach ($this->forms as $form) {
            if (($form['id'] ?? '') === $id) {
                return $form;
            }
        }
        return null;
    }
}
