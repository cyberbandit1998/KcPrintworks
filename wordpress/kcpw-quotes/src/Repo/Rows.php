<?php
declare(strict_types=1);

namespace KcPrintworks\Quotes\Repo;

/**
 * The columns of a quote and what a new row starts with. One list used by every repository (and checked against the table definition by a
 * test), so the in-memory store the workflow tests use and the database store cannot drift apart.
 */
final class Rows
{
    /** column => value a new quote starts with. Strings stay strings and numbers stay numbers (the database store casts the same way). */
    public const DEFAULTS = [
        'ref' => '',
        'status' => 'new',
        'created_at' => 0,
        'updated_at' => 0,
        'name' => '',
        'email' => '',
        'project_type' => '',
        'game' => '',
        'description' => '',
        'dimensions' => '',
        'quantity' => 1,
        'colors' => '',
        'deadline' => '',
        'ship_to' => '',
        'client_hash' => '',
        'quote_title' => '',
        'quote_details' => '',
        'item_cents' => 0,
        'ship_cents' => 0,
        'currency' => '',
        'taxable' => 0,
        'revision' => 0,
        'quoted_at' => 0,
        'expires_at' => 0,
        'approved_at' => 0,
        'pay_by' => 0,
        'paid_at' => 0,
        'token_hash' => '',
        'order_id' => 0,
        'order_fp' => '',
        'order_lease' => '',
        'order_lease_at' => 0,
        'address' => '',
        'phone' => '',
        'attention' => 0,
        'attention_reason' => '',
        'erased' => 0,
    ];

    /** Columns that are text; everything else is a whole number. */
    public static function isText(string $column): bool
    {
        return is_string(self::DEFAULTS[$column] ?? null);
    }

    /**
     * A complete row for a new quote: defaults, then the given fields (unknown columns are refused), with an id.
     *
     * @param array<string,mixed> $fields
     * @return array<string,mixed>
     */
    public static function build(int $id, array $fields): array
    {
        $unknown = array_diff(array_keys($fields), array_keys(self::DEFAULTS));
        if ($unknown !== []) {
            throw new \InvalidArgumentException('Unknown quote column: ' . implode(', ', $unknown));
        }
        return ['id' => $id] + self::cast($fields) + self::DEFAULTS;
    }

    /**
     * Values in their column's type.
     *
     * @param array<string,mixed> $values
     * @return array<string,mixed>
     */
    public static function cast(array $values): array
    {
        $out = [];
        foreach ($values as $column => $value) {
            if ($column === 'id') {
                $out[$column] = (int) $value;
                continue;
            }
            if (!array_key_exists($column, self::DEFAULTS)) {
                throw new \InvalidArgumentException('Unknown quote column: ' . $column);
            }
            $out[$column] = self::isText($column) ? (string) $value : (int) $value;
        }
        return $out;
    }
}
