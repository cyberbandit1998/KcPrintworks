import { catalogSourceName } from '../env';
import { exportCatalog } from './export/source';
import { fixtureCatalog } from './fixture-source';
import type { CatalogSource } from './source';
import { wooCatalog } from './woo/source';

export type { CatalogSource } from './source';

export function getCatalog(): CatalogSource {
  if (catalogSourceName === 'woo') return wooCatalog;
  if (catalogSourceName === 'export') return exportCatalog;
  return fixtureCatalog;
}
