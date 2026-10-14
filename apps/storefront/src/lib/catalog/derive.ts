import type { Category, Product } from '@kcpw/contracts';
import { buildCategoryTree, productsInCategoryTree, readHiddenCategorySlugs } from './queries';
import type { CatalogSource } from './source';

export interface CatalogData {
  products: Product[];
  categories: Category[];
}

/** Flattens the browsable tree depth-first (a parent, then its children), the order shop filters and menus show. */
function flatten(nodes: ReturnType<typeof buildCategoryTree>): Category[] {
  return nodes.flatMap((n) => [n.category, ...flatten(n.children)]);
}

/**
 * Every catalog source (placeholder fixtures, the design-preview export, WooCommerce) answers the same questions the same way:
 * products are matched to categories by id, and a category includes its subcategories. `read` supplies the data.
 */
export function createCatalogSource(read: () => Promise<CatalogData> | CatalogData): CatalogSource {
  return {
    async listProducts() {
      return (await read()).products;
    },
    async getProductBySlug(slug) {
      return (await read()).products.find((p) => p.slug === slug);
    },
    async getProductById(id) {
      return (await read()).products.find((p) => p.id === id);
    },
    async listAllCategories() {
      return (await read()).categories;
    },
    async listCategories() {
      const { products, categories } = await read();
      return flatten(buildCategoryTree(categories, products, readHiddenCategorySlugs()));
    },
    async getCategoryBySlug(slug) {
      return (await read()).categories.find((c) => c.slug === slug);
    },
    async listProductsInCategory(slug) {
      const { products, categories } = await read();
      const category = categories.find((c) => c.slug === slug);
      return category ? productsInCategoryTree(products, categories, category) : [];
    },
  };
}
