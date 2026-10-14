import { createCatalogSource } from './derive';
import { categories, products } from './fixtures';

export const fixtureCatalog = createCatalogSource(() => ({ products, categories }));
