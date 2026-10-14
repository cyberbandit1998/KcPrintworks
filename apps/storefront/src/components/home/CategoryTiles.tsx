import Link from 'next/link';
import type { Category } from '@kcpw/contracts/client';
import { ProductImage } from '../ProductImage';

export interface CategoryTile {
  category: Category;
  total: number;
}

/** "Shop by Category": one tile per top-level category that has products (with the subcategories' products counted). */
export function CategoryTiles({ tiles }: { tiles: readonly CategoryTile[] }) {
  if (tiles.length === 0) return null;
  return (
    <section className="section" aria-labelledby="categories-heading" data-section="categories">
      <div className="container">
        <div className="section__header">
          <h2 id="categories-heading">Shop by Category</h2>
          <Link href="/shop/">All products</Link>
        </div>
        <ul className="category-grid">
          {tiles.map(({ category, total }) => (
            <li key={category.id}>
              <Link className="category-tile" href={`/product-category/${category.slug}/`}>
                {category.imageUrl ? (
                  <span className="category-tile__media" aria-hidden="true">
                    <ProductImage
                      image={{
                        id: category.id,
                        url: category.imageUrl,
                        alt: '',
                        width: 800,
                        height: 800,
                      }}
                      alt=""
                      sizes="(min-width: 48em) 25vw, 50vw"
                    />
                  </span>
                ) : null}
                <span className="category-tile__name">{category.name}</span>
                <span className="category-tile__count">
                  {total} {total === 1 ? 'product' : 'products'}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
