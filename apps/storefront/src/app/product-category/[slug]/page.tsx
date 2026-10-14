import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { toSummary } from '@kcpw/contracts';
import { Breadcrumbs } from '@/components/Breadcrumbs';
import { JsonLd } from '@/components/JsonLd';
import { ProductCard } from '@/components/ProductCard';
import { getCatalog } from '@/lib/catalog';
import { breadcrumbJsonLd } from '@/lib/seo';

type Params = { slug: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params;
  const category = await getCatalog().getCategoryBySlug(slug);
  if (!category) return {};
  return {
    title: category.seo.title,
    description: category.seo.description,
    alternates: { canonical: category.seo.canonicalPath ?? `/product-category/${category.slug}/` },
    robots: category.seo.noindex ? { index: false } : undefined,
  };
}

export default async function CategoryPage({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const catalog = getCatalog();
  const category = await catalog.getCategoryBySlug(slug);
  if (!category) notFound();
  const products = (await catalog.listProductsInCategory(slug)).map(toSummary);
  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: 'Home', path: '/' },
          { name: 'Shop', path: '/shop/' },
          { name: category.name, path: `/product-category/${category.slug}/` },
        ])}
      />
      <Breadcrumbs
        items={[
          { name: 'Home', href: '/' },
          { name: 'Shop', href: '/shop/' },
          { name: category.name },
        ]}
      />
      <div className="container">
        <div className="page-header">
          <h1>{category.name}</h1>
          <p>{category.description}</p>
        </div>
        {products.length === 0 ? (
          <p>No products in this category yet.</p>
        ) : (
          <ul className="product-grid">
            {products.map((product) => (
              <li key={product.id}>
                <ProductCard product={product} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
