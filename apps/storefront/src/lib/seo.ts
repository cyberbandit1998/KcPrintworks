import { priceRange, type Product } from '@kcpw/contracts';
import { siteUrl } from './env';

export const SITE_NAME = 'KCPrintWorks';

export function absoluteUrl(path: string): string {
  return `${siteUrl}${path.startsWith('/') ? path : `/${path}`}`;
}

/** Serialize JSON-LD safely for inline <script>: `<` is escaped so content cannot close the tag. */
export function jsonLdString(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

function dollars(amount: number): string {
  return (amount / 100).toFixed(2);
}

export function productJsonLd(product: Product) {
  const { min, max } = priceRange(product);
  const inStock = product.availability.stockStatus !== 'outofstock';
  const availability = inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock';
  const url = absoluteUrl(`/product/${product.slug}/`);
  const images = product.images.map((i) => absoluteUrl(i.url));
  const offer =
    min.amount === max.amount
      ? {
          '@type': 'Offer',
          url,
          priceCurrency: min.currency,
          price: dollars(min.amount),
          availability,
        }
      : {
          '@type': 'AggregateOffer',
          url,
          priceCurrency: min.currency,
          lowPrice: dollars(min.amount),
          highPrice: dollars(max.amount),
          availability,
        };
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description: product.shortDescription,
    sku: product.sku,
    image: images,
    brand: { '@type': 'Brand', name: SITE_NAME },
    offers: offer,
  };
}

export function breadcrumbJsonLd(items: { name: string; path: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: absoluteUrl(item.path),
    })),
  };
}

export function organizationJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: SITE_NAME,
    url: siteUrl,
  };
}
