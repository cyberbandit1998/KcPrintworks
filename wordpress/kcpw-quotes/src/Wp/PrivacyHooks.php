<?php
declare(strict_types=1);

namespace KcPrintworks\Quotes\Wp;

use KcPrintworks\Quotes\Service\Privacy;

/** Registers the quotes with WordPress's "Export Personal Data" and "Erase Personal Data" tools (Tools menu). */
final class PrivacyHooks
{
    public function __construct(private readonly Privacy $privacy)
    {
    }

    public function register(): void
    {
        add_filter('wp_privacy_personal_data_exporters', [$this, 'exporters']);
        add_filter('wp_privacy_personal_data_erasers', [$this, 'erasers']);
    }

    /** @param array<string,mixed> $exporters @return array<string,mixed> */
    public function exporters(mixed $exporters): mixed
    {
        if (!is_array($exporters)) {
            return $exporters;
        }
        $exporters['kcpw-quotes'] = ['exporter_friendly_name' => 'Custom quote requests', 'callback' => [$this, 'export']];
        return $exporters;
    }

    /** @param array<string,mixed> $erasers @return array<string,mixed> */
    public function erasers(mixed $erasers): mixed
    {
        if (!is_array($erasers)) {
            return $erasers;
        }
        $erasers['kcpw-quotes'] = ['eraser_friendly_name' => 'Custom quote requests', 'callback' => [$this, 'erase']];
        return $erasers;
    }

    /** @return array{data:list<array<string,mixed>>,done:bool} */
    public function export(string $email, int $page = 1): array
    {
        $data = array_map(static fn (array $g): array => ['group_id' => 'kcpw-quotes', 'group_label' => 'Custom quote requests', 'item_id' => $g['id'], 'data' => $g['data']], $this->privacy->export($email));
        return ['data' => $data, 'done' => true];
    }

    /** @return array{items_removed:bool,items_retained:bool,messages:list<string>,done:bool} */
    public function erase(string $email, int $page = 1): array
    {
        $result = $this->privacy->erase($email);
        return ['items_removed' => $result['removed'] > 0, 'items_retained' => $result['retained'] > 0, 'messages' => $result['messages'], 'done' => true];
    }
}
