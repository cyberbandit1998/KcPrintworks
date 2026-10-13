import type { Category, Product } from '@kcpw/contracts';

/**
 * Where product data comes from. Step 1 uses fixtures; Step 2 adds a WooCommerce implementation that reads
 * the cached `kcpw-core` DTO endpoints. Pages depend only on this interface.
 */
export interface CatalogSource {
  listProducts(): Promise<Product[]>;
  getProductBySlug(slug: string): Promise<Product | undefined>;
  getProductById(id: number): Promise<Product | undefined>;
  listCategories(): Promise<Category[]>;
  getCategoryBySlug(slug: string): Promise<Category | undefined>;
  listProductsInCategory(categorySlug: string): Promise<Product[]>;
}
