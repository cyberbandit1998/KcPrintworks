import { describe, expect, it } from 'vitest';
import { CategorySchema, type Category } from '@kcpw/contracts';
import { buildNav, readNavConfig, resolveCategory } from '@/lib/nav';

const cat = (id: number, slug: string, name: string, parentId = 0): Category =>
  CategorySchema.parse({
    id,
    slug,
    name,
    description: '',
    seo: { title: name, description: name, noindex: false },
    parentId,
  });

// The categories the owner verified on the shop (IDs, slugs and parents), plus the other existing ones.
const live = [
  cat(15, 'uncategorized', 'Uncategorized'),
  cat(29, 'game-night', 'Game Night'),
  cat(30, 'homegoods', 'HomeGoods'),
  cat(324, 'new-arrivals', 'New Arrivals'),
  cat(332, 'card-games', 'Card Games', 417),
  cat(370, 'desk-toys', 'Desk Toys'),
  cat(375, 'boxes-bins', 'Boxes & Bins'),
  cat(417, 'game-cases', 'Game Cases'),
  cat(418, 'personalized-gifts', 'Personalized Gifts'),
];

describe('the header navigation', () => {
  it('is exactly Shop | Game Cases | Personalized Gifts | New Arrivals | Blog, in that order', () => {
    const { items } = buildNav(live, readNavConfig({}));
    expect(items.map((i) => [i.label, i.href])).toEqual([
      ['Shop', '/shop/'],
      ['Game Cases', '/product-category/game-cases/'],
      ['Personalized Gifts', '/product-category/personalized-gifts/'],
      ['New Arrivals', '/new-arrivals/'],
      ['Blog', '/blog/'],
    ]);
  });

  it('defaults to the verified slugs and reports which categories they resolved to', () => {
    const { slots } = buildNav(live, readNavConfig({}));
    expect(slots).toEqual([
      { key: 'game-cases', ref: 'game-cases', categoryId: 417, slug: 'game-cases' },
      {
        key: 'personalized-gifts',
        ref: 'personalized-gifts',
        categoryId: 418,
        slug: 'personalized-gifts',
      },
    ]);
  });

  it('can be pointed at a category by id or by slug (a setting, read per request: no rebuild)', () => {
    const byId = buildNav(
      live,
      readNavConfig({ NAV_GAME_CASES: '417', NAV_PERSONALIZED_GIFTS: '418' }),
    );
    expect(byId.slots.map((s) => s.categoryId)).toEqual([417, 418]);
    const swapped = buildNav(live, readNavConfig({ NAV_GAME_CASES: 'card-games' }));
    expect(swapped.items.find((i) => i.key === 'game-cases')?.href).toBe(
      '/product-category/card-games/',
    );
    // An id keeps working if the slug is renamed in WooCommerce: the link uses the CURRENT slug.
    const renamed = live.map((c) => (c.id === 418 ? { ...c, slug: 'gifts-for-you' } : c));
    expect(
      buildNav(renamed, readNavConfig({ NAV_PERSONALIZED_GIFTS: '418' })).items.find(
        (i) => i.key === 'personalized-gifts',
      )?.href,
    ).toBe('/product-category/gifts-for-you/');
  });

  it('leaves a link out when its category does not exist (never guesses, never creates one), and says so', () => {
    const without = live.filter((c) => c.id !== 418);
    const { items, slots } = buildNav(without, readNavConfig({}));
    expect(items.map((i) => i.key)).toEqual(['shop', 'game-cases', 'new-arrivals', 'blog']);
    expect(slots[1]).toEqual({
      key: 'personalized-gifts',
      ref: 'personalized-gifts',
      categoryId: null,
      slug: null,
    });
    expect(buildNav([], readNavConfig({})).items.map((i) => i.key)).toEqual([
      'shop',
      'new-arrivals',
      'blog',
    ]);
  });

  it('matches by slug or id only, never by a name', () => {
    expect(resolveCategory('Game Cases', live)).toBeUndefined();
    expect(resolveCategory('GAME-CASES', live)?.id).toBe(417);
    expect(resolveCategory('417', live)?.slug).toBe('game-cases');
    expect(resolveCategory('', live)).toBeUndefined();
    expect(resolveCategory('9999', live)).toBeUndefined();
  });

  it('treats empty settings (how compose passes an unset name) as the defaults', () => {
    expect(readNavConfig({ NAV_GAME_CASES: '  ', NAV_PERSONALIZED_GIFTS: '' })).toEqual({
      gameCases: 'game-cases',
      personalizedGifts: 'personalized-gifts',
    });
  });
});
