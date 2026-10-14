import type { Category } from '@kcpw/contracts';

/**
 * The header: Shop | Game Cases | Personalized Gifts | New Arrivals | Blog | Cart (the Cart link is its own component).
 *
 * "Game Cases" and "Personalized Gifts" point at WooCommerce categories the owner manages. Which category is a SETTING, read on
 * every request, so changing it needs `docker compose up -d` and never a rebuild:
 *
 *   NAV_GAME_CASES            a category slug or id. Default: game-cases
 *   NAV_PERSONALIZED_GIFTS    a category slug or id. Default: personalized-gifts
 *
 * A category is looked up by its slug or id in the WooCommerce category list; no name is ever matched, nothing is guessed, and nothing
 * is created: if the category does not exist (yet), its link is left out and /api/catalog-status/ says so.
 */
export type NavKey = 'shop' | 'game-cases' | 'personalized-gifts' | 'new-arrivals' | 'blog';

export interface NavItem {
  key: NavKey;
  label: string;
  href: string;
}

export interface NavConfig {
  gameCases: string;
  personalizedGifts: string;
}

export function readNavConfig(env: Record<string, string | undefined> = process.env): NavConfig {
  return {
    gameCases: (env.NAV_GAME_CASES ?? '').trim() || 'game-cases',
    personalizedGifts: (env.NAV_PERSONALIZED_GIFTS ?? '').trim() || 'personalized-gifts',
  };
}

/** `ref` is a numeric category id or a slug. Returns undefined when WooCommerce has no such category. */
export function resolveCategory(
  ref: string,
  categories: readonly Category[],
): Category | undefined {
  const text = ref.trim();
  if (text === '') return undefined;
  return /^\d+$/.test(text)
    ? categories.find((c) => c.id === Number(text))
    : categories.find((c) => c.slug === text.toLowerCase());
}

export interface NavSlot {
  key: 'game-cases' | 'personalized-gifts';
  ref: string;
  categoryId: number | null;
  slug: string | null;
}

export interface NavResolution {
  items: NavItem[];
  slots: NavSlot[];
}

export function buildNav(categories: readonly Category[], config: NavConfig): NavResolution {
  const game = resolveCategory(config.gameCases, categories);
  const gifts = resolveCategory(config.personalizedGifts, categories);
  const slot = (key: NavSlot['key'], ref: string, category: Category | undefined): NavSlot => ({
    key,
    ref,
    categoryId: category?.id ?? null,
    slug: category?.slug ?? null,
  });
  const categoryHref = (c: Category) => `/product-category/${c.slug}/`;
  const items: NavItem[] = [
    { key: 'shop', label: 'Shop', href: '/shop/' },
    ...(game
      ? [{ key: 'game-cases' as const, label: 'Game Cases', href: categoryHref(game) }]
      : []),
    ...(gifts
      ? [
          {
            key: 'personalized-gifts' as const,
            label: 'Personalized Gifts',
            href: categoryHref(gifts),
          },
        ]
      : []),
    { key: 'new-arrivals', label: 'New Arrivals', href: '/new-arrivals/' },
    { key: 'blog', label: 'Blog', href: '/blog/' },
  ];
  return {
    items,
    slots: [
      slot('game-cases', config.gameCases, game),
      slot('personalized-gifts', config.personalizedGifts, gifts),
    ],
  };
}
