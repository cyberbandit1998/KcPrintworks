import { catalogSourceName } from '../env';
import { exportCatalog } from './export/source';
import { fixtureCatalog } from './fixture-source';
import type { CatalogSource } from './source';
import { getWooCatalogService, wooCatalog } from './woo/source';

export type { CatalogSource } from './source';

export function getCatalog(): CatalogSource {
  if (catalogSourceName === 'woo') return wooCatalog;
  if (catalogSourceName === 'export') return exportCatalog;
  return fixtureCatalog;
}

/**
 * "WooCommerce says something differs from what we show": make the next read load fresh data. A no-op for the other sources.
 */
export function refreshCatalog(): void {
  if (catalogSourceName !== 'woo') return;
  try {
    getWooCatalogService().cache.invalidate({ blocking: true });
  } catch {
    // Not configured: nothing to refresh, and the catalog reads already report that.
  }
}
