export function createFixture(host?: string): {
  categories: Record<string, unknown>[];
  products: Record<string, unknown>[];
  variations: Map<number, Record<string, unknown>[]>;
  /** Test control: the mock answers 503 while true. */
  failing?: boolean;
};
