import type { Category, Product } from '@kcpw/contracts';
import type { CatalogSource } from '../source';
import { SwrCache, type CacheStatus } from './cache';
import { readWooConfig } from './config';
import { convertWooCatalog, type WooCatalogResult } from './convert';
import { createWooClient, type WooClient } from './client';
import {
  WooCategorySchema,
  WooProductSchema,
  WooVariationSchema,
  type WooCategory,
  type WooProduct,
  type WooVariation,
} from './rest-schema';

/**
 * The catalog as WooCommerce publishes it, loaded with GET requests only and held in memory (see cache.ts). Customer
 * requests are answered from memory; WooCommerce is asked again in the background when the copy is older than the
 * refresh interval or when the revalidation webhook says something changed.
 */
export interface WooCatalogSnapshot extends WooCatalogResult {
  loadedAt: string;
  /** Rows WooCommerce returned that did not fit the REST schema (id and reason only). */
  rejected: { id: number | null; reason: string }[];
}

const VARIATION_CONCURRENCY = 4;

async function mapLimited<T, R>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}

export function createWooLoader(client: WooClient, now: () => Date = () => new Date()) {
  return async function load(): Promise<WooCatalogSnapshot> {
    const rejected: WooCatalogSnapshot['rejected'] = [];

    const rawProducts = await client.getAll('/products', { status: 'publish' });
    const products: WooProduct[] = [];
    for (const raw of rawProducts) {
      const parsed = WooProductSchema.safeParse(raw);
      if (parsed.success) products.push(parsed.data);
      else {
        const id = (raw as { id?: unknown } | null)?.id;
        rejected.push({
          id: typeof id === 'number' ? id : null,
          reason: parsed.error.issues[0]?.message ?? 'invalid',
        });
      }
    }

    const variableIds = products.filter((p) => p.type === 'variable').map((p) => p.id);
    const loaded = await mapLimited(variableIds, VARIATION_CONCURRENCY, async (id) => {
      const rows = await client.getAll(`/products/${id}/variations`);
      const variations: WooVariation[] = [];
      for (const raw of rows) {
        const parsed = WooVariationSchema.safeParse(raw);
        if (parsed.success) variations.push(parsed.data);
        else
          rejected.push({
            id: (raw as { id?: number } | null)?.id ?? null,
            reason: `variation of ${id}: ${parsed.error.issues[0]?.message ?? 'invalid'}`,
          });
      }
      return [id, variations] as const;
    });

    const categories: WooCategory[] = [];
    for (const raw of await client.getAll('/products/categories')) {
      const parsed = WooCategorySchema.safeParse(raw);
      if (parsed.success) categories.push(parsed.data);
    }

    return {
      ...convertWooCatalog({ products, variations: new Map(loaded), categories }),
      loadedAt: now().toISOString(),
      rejected,
    };
  };
}

export interface WooCatalogService {
  cache: SwrCache<WooCatalogSnapshot>;
  source: CatalogSource;
  status(): CacheStatus;
}

export function createWooCatalogService(
  loader: () => Promise<WooCatalogSnapshot>,
  ttlSeconds: number,
): WooCatalogService {
  const cache = new SwrCache<WooCatalogSnapshot>(loader, { ttlMs: ttlSeconds * 1000 });
  const inCategory = (product: Product, slug: string) =>
    product.categories.some((c) => c.slug === slug);
  const source: CatalogSource = {
    async listProducts() {
      return (await cache.get()).products;
    },
    async getProductBySlug(slug: string) {
      return (await cache.get()).products.find((p) => p.slug === slug);
    },
    async getProductById(id: number) {
      return (await cache.get()).products.find((p) => p.id === id);
    },
    async listCategories(): Promise<Category[]> {
      const { products, categories } = await cache.get();
      // Only categories that have products, and never the catch-all.
      return categories.filter(
        (c) => c.slug !== 'uncategorized' && products.some((p) => inCategory(p, c.slug)),
      );
    },
    async getCategoryBySlug(slug: string) {
      return (await cache.get()).categories.find((c) => c.slug === slug);
    },
    async listProductsInCategory(slug: string) {
      return (await cache.get()).products.filter((p) => inCategory(p, slug));
    },
  };
  return { cache, source, status: () => cache.status() };
}

/**
 * One service per server process. Next bundles route handlers and pages separately, so the instance lives on globalThis:
 * the revalidation route must invalidate the very cache the pages read.
 */
const GLOBAL_KEY = Symbol.for('kcpw.wooCatalogService');
type WithService = typeof globalThis & { [GLOBAL_KEY]?: WooCatalogService };

export class WooNotConfiguredError extends Error {
  constructor(readonly missing: string[]) {
    super(`WooCommerce is not configured. Missing or invalid: ${missing.join(', ')}.`);
    this.name = 'WooNotConfiguredError';
  }
}

export function getWooCatalogService(
  env: Record<string, string | undefined> = process.env,
): WooCatalogService {
  const holder = globalThis as WithService;
  if (holder[GLOBAL_KEY]) return holder[GLOBAL_KEY];
  const config = readWooConfig(env);
  if (!config.ok) throw new WooNotConfiguredError(config.missing);
  const service = createWooCatalogService(
    createWooLoader(createWooClient(config.config)),
    config.config.ttlSeconds,
  );
  holder[GLOBAL_KEY] = service;
  return service;
}

/** A source that resolves the service on first use, so importing this module never needs credentials. */
export const wooCatalog: CatalogSource = {
  listProducts: async () => getWooCatalogService().source.listProducts(),
  getProductBySlug: async (slug) => getWooCatalogService().source.getProductBySlug(slug),
  getProductById: async (id) => getWooCatalogService().source.getProductById(id),
  listCategories: async () => getWooCatalogService().source.listCategories(),
  getCategoryBySlug: async (slug) => getWooCatalogService().source.getCategoryBySlug(slug),
  listProductsInCategory: async (slug) =>
    getWooCatalogService().source.listProductsInCategory(slug),
};
