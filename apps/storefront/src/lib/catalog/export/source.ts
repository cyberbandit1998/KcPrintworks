import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createCatalogSource } from '../derive';
import type { CatalogSource } from '../source';
import { convertExport, type ConvertResult } from './convert';
import { readExport } from './csv';

/**
 * Catalog backed by a local WooCommerce product export, for the design preview with the owner's real products.
 * Server-only (reads files). Enabled with CATALOG_SOURCE=export; never used in production builds.
 *
 *   CATALOG_SOURCE=export npm run dev
 *
 * Settings (all optional):
 *   CATALOG_EXPORT_PATH         the export CSV (default docs/discovery/raw/products.csv, gitignored)
 *   CATALOG_CATEGORIES          proposed (default, from docs/discovery/category-plan.csv) | current
 *   CATALOG_HIDE_DUPLICATES=1   leave out the copies proposed for retirement (display only; nothing is changed)
 *   CATALOG_PLACEHOLDER_IMAGES=1  use local placeholders instead of the live site's photos
 */

const repoRoot = () => path.resolve(process.cwd(), '../..');

function readTable(file: string): Record<string, string>[] {
  return existsSync(/*turbopackIgnore: true*/ file)
    ? readExport(readFileSync(/*turbopackIgnore: true*/ file, 'utf8'))
    : [];
}

export function loadCategoryPlan(file: string) {
  const plan = new Map<string, { name: string; slug: string }>();
  const rows = readTable(file);
  const known = new Map(rows.map((r) => [r.proposed_category!.toLowerCase(), r]));
  for (const r of rows) {
    // The owner's decision column wins when it names one of the proposed categories.
    const decided = (r.owner_decision ?? '').trim().toLowerCase();
    const chosen = decided ? (known.get(decided) ?? r) : r;
    plan.set(r.product_id!, { name: chosen.proposed_category!, slug: chosen.proposed_slug! });
  }
  return plan;
}

export function loadRetiredIds(file: string): Set<string> {
  const ids = new Set<string>();
  for (const r of readTable(file)) {
    for (const id of (r.retire_ids ?? '').split(/[\s,]+/)) if (id) ids.add(id);
  }
  return ids;
}

let cached: ConvertResult | undefined;

export function loadExportCatalog(
  env: Record<string, string | undefined> = process.env,
): ConvertResult {
  if (cached) return cached;
  const exportPath =
    env.CATALOG_EXPORT_PATH ?? path.join(repoRoot(), 'docs/discovery/raw/products.csv');
  if (!existsSync(/*turbopackIgnore: true*/ exportPath)) {
    throw new Error(
      `CATALOG_SOURCE=export needs the product export at ${exportPath}. Put the WooCommerce export there (it is gitignored) or set CATALOG_EXPORT_PATH.`,
    );
  }
  const discovery = path.join(repoRoot(), 'docs/discovery');
  cached = convertExport(readExport(readFileSync(/*turbopackIgnore: true*/ exportPath, 'utf8')), {
    categories: env.CATALOG_CATEGORIES === 'current' ? 'current' : 'proposed',
    categoryPlan: loadCategoryPlan(path.join(discovery, 'category-plan.csv')),
    hide:
      env.CATALOG_HIDE_DUPLICATES === '1'
        ? loadRetiredIds(path.join(discovery, 'duplicate-recommendations.csv'))
        : undefined,
    placeholderImages: env.CATALOG_PLACEHOLDER_IMAGES === '1',
  });
  return cached;
}

export const exportCatalog: CatalogSource = createCatalogSource(() => loadExportCatalog());
