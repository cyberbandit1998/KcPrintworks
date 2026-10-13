import { catalogSourceName } from '../env';
import { exportCatalog } from './export/source';
import { fixtureCatalog } from './fixture-source';
import type { CatalogSource } from './source';

export type { CatalogSource } from './source';

export function getCatalog(): CatalogSource {
  if (catalogSourceName === 'woo') {
    // Implemented in Step 2: reads the cached kcpw-core DTO endpoints with tag-based revalidation.
    throw new Error(
      'CATALOG_SOURCE=woo is not implemented yet (Step 2). Use CATALOG_SOURCE=fixtures.',
    );
  }
  if (catalogSourceName === 'export') return exportCatalog;
  return fixtureCatalog;
}
