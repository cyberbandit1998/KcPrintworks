import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CartLineIntentSchema, readCartLineIntent, lineKey } from '../src';
import * as client from '../src/client';

const SRC = resolve(__dirname, '../src');

/** Specifiers a module imports at runtime. `import type` and `export type` are erased and are skipped. */
function runtimeImports(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  const found: string[] = [];
  const pattern = /^\s*(?:import|export)\s+(type\s+)?(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]/gm;
  for (const match of source.matchAll(pattern)) {
    if (!match[1]) found.push(match[2]!);
  }
  return found;
}

function graph(entry: string): Map<string, string[]> {
  const modules = new Map<string, string[]>();
  const visit = (file: string) => {
    if (modules.has(file)) return;
    const specs = runtimeImports(file);
    modules.set(file, specs);
    for (const spec of specs) {
      if (spec.startsWith('.')) visit(resolve(dirname(file), `${spec}.ts`));
    }
  };
  visit(entry);
  return modules;
}

describe('browser entry (@kcpw/contracts/client)', () => {
  it('reaches no module that imports the validation library', () => {
    const modules = graph(resolve(SRC, 'client.ts'));
    const offenders = [...modules]
      .filter(([, specs]) => specs.some((s) => s === 'zod' || s.startsWith('zod/')))
      .map(([file]) => file.replace(`${SRC}/`, ''));
    expect(offenders).toEqual([]);
    expect(modules.size).toBeGreaterThan(5); // the walk really followed the imports
  });

  it('still exposes everything the product form and cart need', () => {
    for (const name of [
      'addMoney',
      'formatMoney',
      'characterCount',
      'validateOptions',
      'optionPriceAdders',
      'findVariation',
      'selectionLabel',
      'expandVariations',
      'toPurchaseModel',
      'lineKey',
      'readCartLineIntent',
      'MAX_LINE_QUANTITY',
    ]) {
      expect(client, name).toHaveProperty(name);
    }
  });
});

describe('readCartLineIntent agrees with CartLineIntentSchema', () => {
  const long = (n: number) => 'x'.repeat(n);
  const samples: unknown[] = [
    { productId: 1, quantity: 1 },
    { productId: 1, quantity: 1, options: {} },
    {
      productId: 12,
      variationId: 3,
      quantity: 99,
      options: { name: 'Ada', gift: true, off: false },
    },
    { productId: 1, quantity: 2, attributes: { color: 'red', size: '' } },
    { productId: 1, quantity: 1, attributes: { color: long(100) } },
    { productId: 1, quantity: 1, attributes: { color: long(101) } },
    { productId: 1, quantity: 1, options: { note: long(1000) } },
    { productId: 1, quantity: 1, options: { note: long(1001) } },
    { productId: 1, quantity: 1, options: { note: '😀'.repeat(1000) } },
    { productId: 1, quantity: 1, options: { note: '😀'.repeat(1001) } },
    { productId: 1, quantity: 1, options: { n: 3 } },
    { productId: 1, quantity: 1, options: { n: null } },
    { productId: 1, quantity: 1, options: [] },
    { productId: 1, quantity: 1, attributes: [] },
    { productId: 1, quantity: 1, attributes: { a: 1 } },
    { productId: 0, quantity: 1 },
    { productId: -2, quantity: 1 },
    { productId: 1.5, quantity: 1 },
    { productId: '1', quantity: 1 },
    { productId: 1, variationId: 0, quantity: 1 },
    { productId: 1, variationId: 2.5, quantity: 1 },
    { productId: 1, variationId: null, quantity: 1 },
    { productId: 1, quantity: 0 },
    { productId: 1, quantity: 100 },
    { productId: 1, quantity: 1.5 },
    { productId: 1, quantity: '2' },
    { productId: 1, quantity: Number.NaN },
    { productId: 1 },
    { quantity: 1 },
    { productId: 1, quantity: 1, price: 100 },
    { productId: 1, quantity: 1, total: { amount: 1 } },
    { productId: 1, quantity: 1, options: { price: 'free' } },
    JSON.parse('{"productId":1,"quantity":1,"options":{"__proto__":"x"}}'),
    JSON.parse('{"productId":1,"quantity":1,"attributes":{"__proto__":"x"}}'),
    [],
    null,
    undefined,
    'text',
    7,
    true,
  ];

  it.each(samples.map((s, i) => [i, s] as const))('sample %i', (_i, sample) => {
    const expected = CartLineIntentSchema.safeParse(sample);
    const actual = readCartLineIntent(sample);
    expect(actual !== undefined).toBe(expected.success);
    if (expected.success) {
      expect(actual).toEqual(expected.data);
      expect(lineKey(actual!)).toBe(lineKey(expected.data));
    }
  });

  it('agrees on 2,000 pseudo-random mutations of a valid line', () => {
    // Deterministic generator so a failure reproduces.
    let seed = 20261013;
    const next = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
    const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)]!;
    const values: unknown[] = [
      0,
      1,
      99,
      100,
      -1,
      2.5,
      '1',
      '',
      'red',
      true,
      false,
      null,
      [],
      {},
      long(101),
    ];
    const keys = [
      'productId',
      'variationId',
      'attributes',
      'quantity',
      'options',
      'price',
      'extra',
    ];
    let valid = 0;
    for (let i = 0; i < 2000; i++) {
      const candidate: Record<string, unknown> = {
        productId: 5,
        quantity: 2,
        options: { name: 'Ada' },
      };
      for (let m = 0; m < 1 + Math.floor(next() * 3); m++) {
        const key = pick(keys);
        if (next() < 0.2) delete candidate[key];
        else candidate[key] = next() < 0.3 ? { k: pick(values) } : pick(values);
      }
      const expected = CartLineIntentSchema.safeParse(candidate);
      const actual = readCartLineIntent(candidate);
      expect(actual !== undefined, JSON.stringify(candidate)).toBe(expected.success);
      if (expected.success) {
        valid += 1;
        expect(actual).toEqual(expected.data);
      }
    }
    // Both outcomes must be well represented, or the comparison proves little.
    expect(valid).toBeGreaterThan(200);
    expect(valid).toBeLessThan(1800);
  });
});
