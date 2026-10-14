import type { Category, Product } from '@kcpw/contracts';

/**
 * Where product data comes from. Step 1 uses fixtures; Step 2 adds a WooCommerce implementation that reads
 * the cached `kcpw-core` DTO endpoints. Pages depend only on this interface.
 */
export interface CatalogSource {
  listProducts(): Promise<Product[]>;
  getProductBySlug(slug: string): Promise<Product | undefined>;
  getProductById(id: number): Promise<Product | undefined>;
  /** Every category WooCommerce has, with its parent (used for the header, breadcrumbs and the tree). */
  listAllCategories(): Promise<Category[]>;
  /** The categories worth browsing: not hidden, and with at least one product in them or below them. Parent before children. */
  listCategories(): Promise<Category[]>;
  getCategoryBySlug(slug: string): Promise<Category | undefined>;
  /** Products in the category AND in any category below it, each once. */
  listProductsInCategory(categorySlug: string): Promise<Product[]>;
}
