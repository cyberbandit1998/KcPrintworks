import type { Category, Product } from '@kcpw/contracts';

/**
 * Pure questions asked of the cached WooCommerce catalog: which products belong to a category (and its subcategories), in what
 * order, which page. Nothing here reads or changes WooCommerce, and nothing matches a name: categories are matched by id.
 */

export const DEFAULT_PER_PAGE = 24;
export const MAX_PAGE = 1000;

export type SortKey = 'recommended' | 'newest' | 'price-asc' | 'price-desc' | 'name';

export const SORT_OPTIONS: readonly { key: SortKey; label: string }[] = [
  { key: 'recommended', label: 'Recommended' },
  { key: 'newest', label: 'Newest' },
  { key: 'price-asc', label: 'Price: low to high' },
  { key: 'price-desc', label: 'Price: high to low' },
  { key: 'name', label: 'Name: A to Z' },
];

export function parseSort(value: unknown): SortKey {
  const text = Array.isArray(value) ? value[0] : value;
  return SORT_OPTIONS.some((o) => o.key === text) ? (text as SortKey) : 'recommended';
}

export function parsePage(value: unknown): number {
  const text = Array.isArray(value) ? value[0] : value;
  const page = typeof text === 'string' && /^\d{1,4}$/.test(text) ? Number(text) : 1;
  return page >= 1 && page <= MAX_PAGE ? page : 1;
}

// ---------------------------------------------------------------------------------------------------- category tree

const byOrderThenName = (a: Category, b: Category) =>
  a.menuOrder - b.menuOrder || a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });

/** The category and every category below it (children, grandchildren, ...). Safe against a parent loop. */
export function descendantIds(categories: readonly Category[], rootId: number): Set<number> {
  const ids = new Set<number>([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of categories) {
      if (!ids.has(c.id) && ids.has(c.parentId)) {
        ids.add(c.id);
        grew = true;
      }
    }
  }
  return ids;
}

/** Parents of a category, top-most first, not including the category itself. A missing parent or a loop ends the chain. */
export function ancestorsOf(categories: readonly Category[], category: Category): Category[] {
  const chain: Category[] = [];
  const seen = new Set<number>([category.id]);
  let current = category;
  while (current.parentId !== 0) {
    const parent = categories.find((c) => c.id === current.parentId);
    if (!parent || seen.has(parent.id)) break;
    chain.unshift(parent);
    seen.add(parent.id);
    current = parent;
  }
  return chain;
}

/** Products assigned to the category or to any category below it. A product assigned to two of them appears once. */
export function productsInCategoryTree(
  products: readonly Product[],
  categories: readonly Category[],
  root: Category,
): Product[] {
  const ids = descendantIds(categories, root.id);
  return products.filter((p) => p.categories.some((c) => ids.has(c.id)));
}

export interface CategoryNode {
  category: Category;
  /** Products in this category or below it. */
  total: number;
  children: CategoryNode[];
}

/**
 * The browsable category tree: roots first, ordered by WooCommerce's category order then name. `hidden` slugs (the catch-all
 * "Uncategorized", the retired New Arrivals category) are left out, and so is any branch with no products anywhere in it.
 */
export function buildCategoryTree(
  categories: readonly Category[],
  products: readonly Product[],
  hidden: ReadonlySet<string>,
): CategoryNode[] {
  const visible = categories.filter((c) => !hidden.has(c.slug));
  const ids = new Set(visible.map((c) => c.id));
  const build = (category: Category, depth: number): CategoryNode | undefined => {
    const total = productsInCategoryTree(products, categories, category).length;
    if (total === 0) return undefined;
    const children =
      depth >= 6
        ? []
        : visible
            .filter((c) => c.parentId === category.id && c.id !== category.id)
            .sort(byOrderThenName)
            .map((c) => build(c, depth + 1))
            .filter((n): n is CategoryNode => n !== undefined);
    return { category, total, children };
  };
  return visible
    .filter((c) => c.parentId === 0 || !ids.has(c.parentId)) // an orphan is treated as a top-level category
    .sort(byOrderThenName)
    .map((c) => build(c, 0))
    .filter((n): n is CategoryNode => n !== undefined);
}

export function findCategoryNode(
  nodes: readonly CategoryNode[],
  id: number,
): CategoryNode | undefined {
  for (const node of nodes) {
    if (node.category.id === id) return node;
    const inside = findCategoryNode(node.children, id);
    if (inside) return inside;
  }
  return undefined;
}

/** The most specific visible category of a product (deepest in the tree), for its breadcrumb. */
export function primaryCategory(
  product: Product,
  categories: readonly Category[],
  hidden: ReadonlySet<string>,
): { category: Category; ancestors: Category[] } | undefined {
  const candidates = product.categories
    .map((ref) => categories.find((c) => c.id === ref.id))
    .filter((c): c is Category => c !== undefined && !hidden.has(c.slug));
  const ranked = candidates
    .map((category) => ({ category, ancestors: ancestorsOf(categories, category) }))
    .sort(
      (a, b) => b.ancestors.length - a.ancestors.length || byOrderThenName(a.category, b.category),
    );
  return ranked[0];
}

// ---------------------------------------------------------------------------------------------------- ordering

const newestFirst = (a: Product, b: Product) =>
  b.publishedAt.localeCompare(a.publishedAt) || b.id - a.id;

const recommended = (a: Product, b: Product) => a.menuOrder - b.menuOrder || newestFirst(a, b);

const name = (a: Product, b: Product) =>
  a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) || a.id - b.id;

/** A new array; the input is not changed. Price is the shown price (the lowest variation for a variable product). */
export function sortProducts(products: readonly Product[], sort: SortKey): Product[] {
  const compare: Record<SortKey, (a: Product, b: Product) => number> = {
    recommended,
    newest: newestFirst,
    'price-asc': (a, b) => a.price.amount - b.price.amount || name(a, b),
    'price-desc': (a, b) => b.price.amount - a.price.amount || name(a, b),
    name,
  };
  return [...products].sort(compare[sort]);
}

/** Published products marked Featured in WooCommerce, in WooCommerce's manual order, then newest first. Never padded. */
export function featuredProducts(products: readonly Product[], limit = 8): Product[] {
  return products
    .filter((p) => p.featured)
    .sort(recommended)
    .slice(0, limit);
}

/** Every product, newest published first (the publication date decides, never a category). */
export function newArrivals(products: readonly Product[]): Product[] {
  return [...products].sort(newestFirst);
}

// ---------------------------------------------------------------------------------------------------- paging

export interface Page<T> {
  items: T[];
  page: number;
  pages: number;
  total: number;
  perPage: number;
}

/** `page` past the end is clamped to the last page, so a stale link shows something rather than nothing. */
export function paginate<T>(
  items: readonly T[],
  page: number,
  perPage = DEFAULT_PER_PAGE,
): Page<T> {
  const total = items.length;
  const pages = Math.max(1, Math.ceil(total / perPage));
  const current = Math.min(Math.max(1, Math.floor(page)), pages);
  return {
    items: items.slice((current - 1) * perPage, current * perPage),
    page: current,
    pages,
    total,
    perPage,
  };
}

/** Category slugs kept out of browsing: the catch-all and the retired New Arrivals category. Override with HIDDEN_CATEGORY_SLUGS. */
export function readHiddenCategorySlugs(
  env: Record<string, string | undefined> = process.env,
): ReadonlySet<string> {
  const raw = env.HIDDEN_CATEGORY_SLUGS;
  const text = raw === undefined || raw.trim() === '' ? 'uncategorized,new-arrivals' : raw;
  return new Set(
    text
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}
