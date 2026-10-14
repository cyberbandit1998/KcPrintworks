import type { Category, Product } from '@kcpw/contracts';
import { readNavConfig, resolveCategory } from '../nav';
import { buildCategoryTree, readHiddenCategorySlugs } from './queries';

/**
 * The "Shop by Category" tiles: top-level categories that have products (their subcategories' products counted), with the two
 * header categories (Game Cases, Personalized Gifts) first and the rest in WooCommerce's category order.
 */
export function categoryTiles(
  categories: readonly Category[],
  products: readonly Product[],
  env: Record<string, string | undefined> = process.env,
): { category: Category; total: number }[] {
  const nav = readNavConfig(env);
  const first = [nav.gameCases, nav.personalizedGifts]
    .map((ref) => resolveCategory(ref, categories)?.id)
    .filter((id): id is number => id !== undefined);
  const roots = buildCategoryTree(categories, products, readHiddenCategorySlugs(env));
  const rank = (id: number) => {
    const index = first.indexOf(id);
    return index === -1 ? first.length : index;
  };
  return roots
    .map((node, order) => ({ category: node.category, total: node.total, order }))
    .sort((a, b) => rank(a.category.id) - rank(b.category.id) || a.order - b.order)
    .map(({ category, total }) => ({ category, total }));
}
