import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Breadcrumbs } from '@/components/Breadcrumbs';
import { Gallery } from '@/components/Gallery';
import { ProductReviews } from '@/components/ProductReviews';
import { RatingSummary } from '@/components/RatingSummary';
import { ReviewFormSection } from '@/components/ReviewFormSection';
import { JsonLd } from '@/components/JsonLd';
import { ProductPurchase } from '@/components/ProductPurchase';
import { RichText } from '@/components/RichText';
import { getCatalog } from '@/lib/catalog';
import { primaryCategory, readHiddenCategorySlugs } from '@/lib/catalog/queries';
import { parsePage } from '@/lib/catalog/queries';
import { productReviews } from '@/lib/reviews';
import { breadcrumbJsonLd, productJsonLd } from '@/lib/seo';
import { withTimeout } from '@/lib/with-timeout';
import { toPurchaseModel } from '@kcpw/contracts';

type Params = { slug: string };
type SearchParams = Record<string, string | string[] | undefined>;

/** Reviews are a nicety: a slow or unreachable shop must not hold the product back. */
const REVIEWS_WAIT_MS = 3000;

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

export default async function ProductPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<SearchParams>;
}) {
  const { slug } = await params;
  const product = await getCatalog().getProductBySlug(slug);
  if (!product) notFound();
  const categories = await getCatalog().listAllCategories();
  const reviewPage = parsePage((await searchParams).review_page);
  const reviews = product.reviewsAllowed
    ? await withTimeout(productReviews(product.id, reviewPage), REVIEWS_WAIT_MS, null)
    : null;
  // The most specific category (a child before its parent), with its parents in front, so the breadcrumb follows the real tree.
  const primary = primaryCategory(product, categories, readHiddenCategorySlugs());
  const trail = primary ? [...primary.ancestors, primary.category] : [];
  return (
    <>
      <JsonLd data={productJsonLd(product, reviews?.reviews ?? [])} />
      <JsonLd
        data={breadcrumbJsonLd([
          { name: 'Home', path: '/' },
          { name: 'Shop', path: '/shop/' },
          ...trail.map((c) => ({ name: c.name, path: `/product-category/${c.slug}/` })),
          { name: product.name, path: `/product/${product.slug}/` },
        ])}
      />
      <Breadcrumbs
        items={[
          { name: 'Home', href: '/' },
          { name: 'Shop', href: '/shop/' },
          ...trail.map((c) => ({ name: c.name, href: `/product-category/${c.slug}/` })),
          { name: product.name },
        ]}
      />
      <div className="container pdp">
        <Gallery images={product.images} />
        <div>
          <h1 className={product.name.length > 60 ? 'pdp__title pdp__title--long' : 'pdp__title'}>
            {product.name}
          </h1>
          <RatingSummary rating={product.reviewsAllowed ? product.rating : undefined} />
          <p>{product.shortDescription}</p>
          <ProductPurchase product={toPurchaseModel(product)} />
          <section aria-labelledby="details-heading" style={{ marginTop: 'var(--space-6)' }}>
            <h2 id="details-heading">Details</h2>
            <RichText html={product.descriptionHtml} />
          </section>
        </div>
      </div>
      <ProductReviews product={product} result={reviews}>
        <ReviewFormSection product={product} />
      </ProductReviews>
    </>
  );
}
