import type { CatalogSource } from './source';
import { categories, products } from './fixtures';

export const fixtureCatalog: CatalogSource = {
  async listProducts() {
    return products;
  },
  async getProductBySlug(slug) {
    return products.find((p) => p.slug === slug);
  },
  async getProductById(id) {
    return products.find((p) => p.id === id);
  },
  async listCategories() {
    return categories;
  },
  async getCategoryBySlug(slug) {
    return categories.find((c) => c.slug === slug);
  },
  async listProductsInCategory(categorySlug) {
    return products.filter((p) => p.categories.some((c) => c.slug === categorySlug));
  },
};
