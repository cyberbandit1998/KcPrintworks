import type { Category, Product } from '@kcpw/contracts';
import type { Money } from '@kcpw/contracts/client';

/** What the live results list needs about a product: enough to draw a row, nothing the visitor should not already see on the shop. */
export interface SearchHitDto {
  id: number;
  slug: string;
  name: string;
  price: Money;
  /** The price is a "from" price (a product with several prices). */
  from: boolean;
  image?: { url: string; width: number; height: number };
  category?: string;
}

/** The first category of the product that the shop shows (the catch-all and retired categories are hidden everywhere). */
export function displayCategory(
  product: Product,
  categories: readonly Category[],
  hidden: ReadonlySet<string>,
): Category | undefined {
  const byId = new Map(categories.map((c) => [c.id, c]));
  for (const ref of product.categories) {
    const category = byId.get(ref.id);
    if (category && !hidden.has(category.slug)) return category;
  }
  return undefined;
}

export function toHitDto(
  product: Product,
  categories: readonly Category[],
  hidden: ReadonlySet<string>,
): SearchHitDto {
  const image = product.images[0];
  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    price: product.price,
    from: product.type === 'variable',
    ...(image ? { image: { url: image.url, width: image.width, height: image.height } } : {}),
    ...(displayCategory(product, categories, hidden)
      ? { category: displayCategory(product, categories, hidden)!.name }
      : {}),
  };
}

/** The query as typed, made safe to carry in an address and to search: control characters removed, spaces collapsed, at most 80 characters. */
export function cleanQuery(value: unknown): string {
  const text = Array.isArray(value) ? value[0] : value;
  if (typeof text !== 'string') return '';
  return text
    .replace(/[\p{Cc}\p{Cf}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}
