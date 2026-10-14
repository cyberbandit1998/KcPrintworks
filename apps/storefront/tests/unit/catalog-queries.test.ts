import { describe, expect, it } from 'vitest';
import { CategorySchema, ProductSchema, money, type Category, type Product } from '@kcpw/contracts';
import { categoryTiles } from '@/lib/catalog/home';
import { createCatalogSource } from '@/lib/catalog/derive';
import {
  ancestorsOf,
  buildCategoryTree,
  descendantIds,
  featuredProducts,
  findCategoryNode,
  newArrivals,
  paginate,
  parsePage,
  parseSort,
  primaryCategory,
  productsInCategoryTree,
  readHiddenCategorySlugs,
  sortProducts,
} from '@/lib/catalog/queries';
import { listHref } from '@/lib/list-url';

/** The shape the owner verified on the real shop: Game Cases (417) > Card Games (332), and Personalized Gifts (418) alone. */
const cat = (id: number, slug: string, name: string, parentId = 0, menuOrder = 0): Category =>
  CategorySchema.parse({
    id,
    slug,
    name,
    description: '',
    seo: { title: name, description: name, noindex: false },
    parentId,
    menuOrder,
  });

const categories = [
  cat(15, 'uncategorized', 'Uncategorized'),
  cat(324, 'new-arrivals', 'New Arrivals'),
  cat(417, 'game-cases', 'Game Cases'),
  cat(332, 'card-games', 'Card Games', 417),
  cat(418, 'personalized-gifts', 'Personalized Gifts'),
  cat(370, 'desk-toys', 'Desk Toys'),
  cat(500, 'aaa-first-alphabetically', 'AAA Other'),
];

function product(
  id: number,
  name: string,
  categoryIds: number[],
  extra: Partial<Product> = {},
): Product {
  return ProductSchema.parse({
    id,
    slug:
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || `p-${id}`,
    type: 'simple',
    name,
    descriptionHtml: '',
    shortDescription: '',
    price: money(1000),
    images: [],
    categories: categoryIds.map((cid) => {
      const c = categories.find((x) => x.id === cid)!;
      return { id: c.id, slug: c.slug, name: c.name };
    }),
    attributes: [],
    variations: [],
    optionSchema: { version: 1, fields: [] },
    availability: { purchasable: true, stockStatus: 'instock', madeToOrder: false },
    seo: { title: name, description: name, noindex: false },
    updatedAt: '2026-10-01T00:00:00Z',
    ...extra,
  });
}

const products = [
  product(1, 'Alpha', [332], { publishedAt: '2026-10-10T00:00:00Z', price: money(1100) }),
  product(2, 'Beta', [332, 417], { publishedAt: '2026-10-12T00:00:00Z', price: money(900) }),
  product(3, 'Gamma', [417], { publishedAt: '2026-10-09T00:00:00Z', price: money(2500) }),
  product(4, 'Delta', [418], { publishedAt: '2026-10-11T00:00:00Z', price: money(1600) }),
  product(5, 'Epsilon', [324], { publishedAt: '2026-01-01T00:00:00Z' }),
  product(6, 'Zeta', [15], { publishedAt: '2026-10-13T00:00:00Z' }),
];

describe('category trees: a parent includes its children', () => {
  it('finds a category and everything below it', () => {
    expect([...descendantIds(categories, 417)].sort()).toEqual([332, 417]);
    expect([...descendantIds(categories, 332)]).toEqual([332]);
    expect([...descendantIds(categories, 418)]).toEqual([418]);
  });

  it('Game Cases shows products assigned to it AND to Card Games, each once, though it has none of its own children-only', () => {
    const gameCases = categories.find((c) => c.id === 417)!;
    expect(productsInCategoryTree(products, categories, gameCases).map((p) => p.id)).toEqual([
      1, 2, 3,
    ]);
    // Even if Game Cases had no product assigned directly, the child's products belong to it (the Store API behaves the same).
    const onlyChild = products.filter((p) => p.id === 1);
    expect(productsInCategoryTree(onlyChild, categories, gameCases).map((p) => p.id)).toEqual([1]);
  });

  it('matches by id, never by name', () => {
    const impostor = [product(9, 'Game Cases', [418])];
    const gameCases = categories.find((c) => c.id === 417)!;
    expect(productsInCategoryTree(impostor, categories, gameCases)).toEqual([]);
  });

  it('survives a parent loop and a missing parent', () => {
    const loop = [cat(1, 'a', 'A', 2), cat(2, 'b', 'B', 1)];
    expect([...descendantIds(loop, 1)].sort()).toEqual([1, 2]);
    expect(ancestorsOf(loop, loop[0]!).map((c) => c.id)).toEqual([2]);
    const orphan = [cat(7, 'orphan', 'Orphan', 999)];
    expect(ancestorsOf(orphan, orphan[0]!)).toEqual([]);
  });

  it('builds the browsable tree: hidden and empty branches are left out, parents carry their children’s counts', () => {
    const tree = buildCategoryTree(categories, products, readHiddenCategorySlugs({}));
    expect(tree.map((n) => [n.category.slug, n.total])).toEqual([
      ['game-cases', 3],
      ['personalized-gifts', 1],
    ]);
    expect(tree[0]!.children.map((n) => [n.category.slug, n.total])).toEqual([['card-games', 2]]);
    expect(findCategoryNode(tree, 332)?.category.slug).toBe('card-games');
    // Desk Toys has no products; Uncategorized and New Arrivals are hidden by default.
    expect(JSON.stringify(tree)).not.toContain('desk-toys');
    expect(JSON.stringify(tree)).not.toContain('"uncategorized"');
    expect(JSON.stringify(tree)).not.toContain('"new-arrivals"');
  });

  it('hidden slugs can be changed, and "off" values do not crash', () => {
    expect([...readHiddenCategorySlugs({ HIDDEN_CATEGORY_SLUGS: 'Desk-Toys , x' })]).toEqual([
      'desk-toys',
      'x',
    ]);
    expect([...readHiddenCategorySlugs({ HIDDEN_CATEGORY_SLUGS: '' })]).toEqual([
      'uncategorized',
      'new-arrivals',
    ]);
  });

  it('picks the most specific category for a breadcrumb', () => {
    const both = product(8, 'Both', [417, 332]);
    const result = primaryCategory(both, categories, readHiddenCategorySlugs({}));
    expect(result?.category.slug).toBe('card-games');
    expect(result?.ancestors.map((c) => c.slug)).toEqual(['game-cases']);
    expect(
      primaryCategory(product(10, 'Lost', [15]), categories, readHiddenCategorySlugs({})),
    ).toBeUndefined();
  });
});

describe('ordering', () => {
  it('New Arrivals: newest published first, whatever category a product is in', () => {
    expect(newArrivals(products).map((p) => p.name)).toEqual([
      'Zeta',
      'Beta',
      'Delta',
      'Alpha',
      'Gamma',
      'Epsilon', // in the New Arrivals CATEGORY but published in January: last, never first
    ]);
  });

  it('newest, price and name sorts, with stable ties', () => {
    expect(sortProducts(products, 'newest').map((p) => p.id)).toEqual([6, 2, 4, 1, 3, 5]);
    expect(
      sortProducts(products, 'price-asc')
        .map((p) => p.price.amount)
        .slice(0, 2),
    ).toEqual([900, 1000]);
    expect(sortProducts(products, 'price-desc')[0]!.name).toBe('Gamma');
    expect(sortProducts(products, 'name').map((p) => p.name)).toEqual([
      'Alpha',
      'Beta',
      'Delta',
      'Epsilon',
      'Gamma',
      'Zeta',
    ]);
    const input = [...products];
    sortProducts(input, 'name');
    expect(input).toEqual(products); // the input is not reordered
  });

  it('recommended = WooCommerce manual order, then newest', () => {
    const arranged = [
      product(1, 'One', [417], { menuOrder: 2, publishedAt: '2026-10-01T00:00:00Z' }),
      product(2, 'Two', [417], { menuOrder: 1, publishedAt: '2026-09-01T00:00:00Z' }),
      product(3, 'Three', [417], { menuOrder: 1, publishedAt: '2026-10-05T00:00:00Z' }),
    ];
    expect(sortProducts(arranged, 'recommended').map((p) => p.name)).toEqual([
      'Three',
      'Two',
      'One',
    ]);
  });

  it('Featured: only products marked Featured, in a predictable order, capped, never padded', () => {
    expect(featuredProducts(products)).toEqual([]); // none starred: the section is empty, nothing substituted
    const starred = [
      product(1, 'A', [417], { featured: true, menuOrder: 2 }),
      product(2, 'B', [417], { featured: true, menuOrder: 1, publishedAt: '2026-10-01T00:00:00Z' }),
      product(3, 'C', [417], { featured: true, menuOrder: 1, publishedAt: '2026-10-02T00:00:00Z' }),
      product(4, 'D', [417]),
    ];
    expect(featuredProducts(starred).map((p) => p.name)).toEqual(['C', 'B', 'A']);
    expect(featuredProducts(starred, 2).map((p) => p.name)).toEqual(['C', 'B']);
  });

  it('parses sort and page leniently and safely', () => {
    expect(parseSort('newest')).toBe('newest');
    expect(parseSort('drop table')).toBe('recommended');
    expect(parseSort(undefined)).toBe('recommended');
    expect(parseSort(['name', 'x'])).toBe('name');
    expect(parsePage('3')).toBe(3);
    for (const bad of ['0', '-1', 'x', '1.5', '99999', '', undefined])
      expect(parsePage(bad), String(bad)).toBe(1);
  });
});

describe('pagination', () => {
  const items = Array.from({ length: 26 }, (_, i) => i + 1);

  it('splits into pages and reports the totals', () => {
    expect(paginate(items, 1, 24)).toMatchObject({ page: 1, pages: 2, total: 26 });
    expect(paginate(items, 1, 24).items).toHaveLength(24);
    expect(paginate(items, 2, 24).items).toEqual([25, 26]);
  });

  it('clamps a page that is too high or too low, and handles an empty list', () => {
    expect(paginate(items, 99, 24).page).toBe(2);
    expect(paginate(items, 0, 24).page).toBe(1);
    expect(paginate([], 1, 24)).toMatchObject({ page: 1, pages: 1, total: 0, items: [] });
  });

  it('builds clean addresses: defaults are left out', () => {
    expect(listHref('/shop/', {})).toBe('/shop/');
    expect(listHref('/shop/', { sort: 'recommended', page: 1 })).toBe('/shop/');
    expect(listHref('/shop/', { sort: 'newest', page: 2 })).toBe('/shop/?sort=newest&page=2');
  });
});

describe('the catalog source built from data', () => {
  const source = createCatalogSource(() => ({ products, categories }));

  it('lists every category for the header, and the browsable ones (parent before child) for filters', async () => {
    expect((await source.listAllCategories()).map((c) => c.id)).toContain(417);
    expect((await source.listCategories()).map((c) => c.slug)).toEqual([
      'game-cases',
      'card-games',
      'personalized-gifts',
    ]);
  });

  it('answers a category with its subcategories’ products', async () => {
    expect((await source.listProductsInCategory('game-cases')).map((p) => p.id)).toEqual([1, 2, 3]);
    expect((await source.listProductsInCategory('card-games')).map((p) => p.id)).toEqual([1, 2]);
    expect(await source.listProductsInCategory('nope')).toEqual([]);
  });

  it('Shop by Category: the two header categories first, then the rest in WooCommerce order', () => {
    const more = categories;
    const withProduct = [...products, product(20, 'Other', [500])];
    expect(categoryTiles(more, withProduct, {}).map((t) => t.category.slug)).toEqual([
      'game-cases',
      'personalized-gifts',
      'aaa-first-alphabetically',
    ]);
    // Reconfigured by slug or id, with no code change.
    expect(
      categoryTiles(more, withProduct, {
        NAV_GAME_CASES: '418',
        NAV_PERSONALIZED_GIFTS: 'game-cases',
      }).map((t) => t.category.slug),
    ).toEqual(['personalized-gifts', 'game-cases', 'aaa-first-alphabetically']);
  });
});
