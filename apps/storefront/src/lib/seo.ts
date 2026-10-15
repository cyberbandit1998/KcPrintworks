import { priceRange, type Product } from '@kcpw/contracts';
import { siteUrl } from './env';
import type { Review } from './reviews/types';

export const SITE_NAME = 'KCPrintWorks';

export function absoluteUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path; // already absolute (photos hosted by WooCommerce)
  return `${siteUrl}${path.startsWith('/') ? path : `/${path}`}`;
}

/** Serialize JSON-LD safely for inline <script>: `<` is escaped so content cannot close the tag. */
export function jsonLdString(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

function dollars(amount: number): string {
  return (amount / 100).toFixed(2);
}

/**
 * Rating and reviews for the Product entry, only from what WooCommerce reports: its own average and count of approved ratings, and the
 * approved reviews that are shown on the page. Nothing is added when there are none.
 */
function reviewJsonLd(product: Product, reviews: readonly Review[]) {
  const aggregate = product.rating
    ? {
        aggregateRating: {
          '@type': 'AggregateRating',
          ratingValue: product.rating.average,
          reviewCount: product.rating.count,
          bestRating: 5,
          worstRating: 1,
        },
      }
    : {};
  if (!product.rating || reviews.length === 0) return aggregate;
  return {
    ...aggregate,
    review: reviews.map((review) => ({
      '@type': 'Review',
      author: { '@type': 'Person', name: review.author },
      datePublished: review.publishedAt,
      reviewBody: review.paragraphs.join('\n\n'),
      reviewRating: {
        '@type': 'Rating',
        ratingValue: review.rating,
        bestRating: 5,
        worstRating: 1,
      },
    })),
  };
}

export function productJsonLd(product: Product, reviews: readonly Review[] = []) {
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
    ...reviewJsonLd(product, reviews),
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

/** The site's own search, so a search engine can offer a search box for it. The address matches the /search/ page. */
export function websiteJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE_NAME,
    url: siteUrl,
    potentialAction: {
      '@type': 'SearchAction',
      target: { '@type': 'EntryPoint', urlTemplate: `${siteUrl}/search/?q={search_term_string}` },
      'query-input': 'required name=search_term_string',
    },
  };
}

export interface ArticleLd {
  title: string;
  description: string;
  path: string;
  publishedAt: string;
  modifiedAt: string;
  image?: string;
}

/**
 * A blog post as schema.org BlogPosting (a kind of Article). The author is the shop itself: WordPress user names are not
 * published by the storefront. Every value comes from the post.
 */
export function articleJsonLd(article: ArticleLd) {
  const url = absoluteUrl(article.path);
  return {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: article.title,
    ...(article.description ? { description: article.description } : {}),
    url,
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    datePublished: article.publishedAt,
    dateModified: article.modifiedAt,
    ...(article.image ? { image: [absoluteUrl(article.image)] } : {}),
    author: { '@type': 'Organization', name: SITE_NAME, url: siteUrl },
    publisher: { '@type': 'Organization', name: SITE_NAME, url: siteUrl },
  };
}

/** A meta description from some text: whole words, at most `max` characters. */
export function trimDescription(text: string, max = 160): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s,.;:–—-]+$/u, '')}…`;
}
