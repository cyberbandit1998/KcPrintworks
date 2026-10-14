import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Breadcrumbs } from '@/components/Breadcrumbs';
import { Gallery } from '@/components/Gallery';
import { JsonLd } from '@/components/JsonLd';
import { ProductPurchase } from '@/components/ProductPurchase';
import { RichText } from '@/components/RichText';
import { getCatalog } from '@/lib/catalog';
import { breadcrumbJsonLd, productJsonLd } from '@/lib/seo';
import { toPurchaseModel } from '@kcpw/contracts';

type Params = { slug: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params;
  const product = await getCatalog().getProductBySlug(slug);
  if (!product) return {};
  const image = product.images[0];
  return {
    title: product.seo.title,
    description: product.seo.description,
    alternates: { canonical: product.seo.canonicalPath ?? `/product/${product.slug}/` },
    robots: product.seo.noindex ? { index: false } : undefined,
    openGraph: {
      title: product.seo.title,
      description: product.seo.description,
      type: 'website',
      images: image
        ? [{ url: image.url, width: image.width, height: image.height, alt: image.alt }]
        : undefined,
    },
  };
}

export default async function ProductPage({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const product = await getCatalog().getProductBySlug(slug);
  if (!product) notFound();
  const category = product.categories[0];
  return (
    <>
      <JsonLd data={productJsonLd(product)} />
      <JsonLd
        data={breadcrumbJsonLd([
          { name: 'Home', path: '/' },
          { name: 'Shop', path: '/shop/' },
          ...(category
            ? [{ name: category.name, path: `/product-category/${category.slug}/` }]
            : []),
          { name: product.name, path: `/product/${product.slug}/` },
        ])}
      />
      <Breadcrumbs
        items={[
          { name: 'Home', href: '/' },
          { name: 'Shop', href: '/shop/' },
          ...(category
            ? [{ name: category.name, href: `/product-category/${category.slug}/` }]
            : []),
          { name: product.name },
        ]}
      />
      <div className="container pdp">
        <Gallery images={product.images} />
        <div>
          <h1 className={product.name.length > 60 ? 'pdp__title pdp__title--long' : 'pdp__title'}>
            {product.name}
          </h1>
          <p>{product.shortDescription}</p>
          <ProductPurchase product={toPurchaseModel(product)} />
          <section aria-labelledby="details-heading" style={{ marginTop: 'var(--space-6)' }}>
            <h2 id="details-heading">Details</h2>
            <RichText html={product.descriptionHtml} />
          </section>
        </div>
      </div>
    </>
  );
}
