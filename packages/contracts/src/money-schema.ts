import { z } from 'zod';
import type { Money } from './money';

/**
 * Runtime validation for `Money`. Kept apart from money.ts so the browser can do arithmetic and formatting
 * without downloading the validation library (see client.ts).
 */
export const MoneySchema = z.object({
  amount: z.number().int(),
  currency: z.string().length(3),
});

// Fails to compile if the schema and the interface ever drift apart.
const _schemaMatchesType: z.infer<typeof MoneySchema> extends Money
  ? Money extends z.infer<typeof MoneySchema>
    ? true
    : never
  : never = true;
void _schemaMatchesType;
