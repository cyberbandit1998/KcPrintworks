import type { Metadata } from 'next';
import Link from 'next/link';
import { toSummary } from '@kcpw/contracts';
import { Breadcrumbs } from '@/components/Breadcrumbs';
import { ProductCard } from '@/components/ProductCard';
import { getCatalog } from '@/lib/catalog';

export const metadata: Metadata = {
  title: 'Shop all products',
  description: 'Browse all personalized, made-to-order products.',
  alternates: { canonical: '/shop/' },
};

export default async function ShopPage() {
  const catalog = getCatalog();
  const [products, categories] = await Promise.all([
    catalog.listProducts(),
    catalog.listCategories(),
  ]);
  return (
    <>
      <Breadcrumbs items={[{ name: 'Home', href: '/' }, { name: 'Shop' }]} />
      <div className="container">
        <div className="page-header">
          <h1>Shop all products</h1>
          <p>{products.length} products</p>
        </div>
        <nav aria-label="Categories">
          <ul className="chips">
            {categories.map((category) => (
              <li key={category.slug}>
                <Link className="chip" href={`/product-category/${category.slug}/`}>
                  {category.name}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <ul className="product-grid">
          {products.map((product) => (
            <li key={product.id}>
              <ProductCard product={toSummary(product)} />
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
