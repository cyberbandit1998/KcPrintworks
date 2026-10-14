import { getImageProps } from 'next/image';
import Link from 'next/link';
import { toSummary } from '@kcpw/contracts';
import { JsonLd } from '@/components/JsonLd';
import { ProductCard } from '@/components/ProductCard';
import { getCatalog } from '@/lib/catalog';
import { organizationJsonLd } from '@/lib/seo';

/**
 * The owner's workshop photograph, in two crops of the same picture (the full-resolution original is kept in
 * assets/hero, outside public/, and the commands that made these are in public/images/README.md):
 * wide for desktop and tablet, and the printers' side of it for phones. Next resizes and re-encodes both per screen.
 * To change the photo, replace these files (same names) or point these paths at new ones.
 */
const HERO_WIDE = { src: '/images/kcprintworks-hero.webp', width: 1916, height: 821 };
const HERO_PHONE = { src: '/images/kcprintworks-hero-mobile.webp', width: 1100, height: 821 };

/**
 * Decorative (alt=""): the headline and buttons are real text, so the photo needs no description. It is the page's largest
 * image, so it is fetched first (fetchpriority=high, never lazy) and sits in the server-rendered HTML where the browser finds it at once.
 */
function HeroPhoto() {
  const common = { alt: '', sizes: '100vw', priority: true, fetchPriority: 'high' } as const;
  const wide = getImageProps({ ...common, ...HERO_WIDE }).props;
  const phone = getImageProps({ ...common, ...HERO_PHONE }).props;
  return (
    <picture className="hero__photo">
      <source media="(min-width: 40em)" srcSet={wide.srcSet} sizes={wide.sizes} />
      {/* Art direction: these props come from next/image's getImageProps, so the file is still resized and re-encoded by the optimizer. */}
      <img {...phone} alt="" />
    </picture>
  );
}

// Placeholder marketing copy for design review. Real copy comes from the owner.
const steps = [
  { title: 'Choose', text: 'Pick a product and any options like size or finish.' },
  { title: 'Personalize', text: 'Add your text or choices. We save them with your order.' },
  { title: 'We make it', text: 'Each item is made to order and shipped to you.' },
];

export default async function HomePage() {
  const products = (await getCatalog().listProducts()).slice(0, 4).map(toSummary);
  return (
    <>
      <JsonLd data={organizationJsonLd()} />
      <section className="hero" aria-labelledby="hero-heading">
        <HeroPhoto />
        <div className="container hero__content">
          <div className="hero__text">
            <h1 id="hero-heading">
              <span className="hero__line">Michigan Made.</span>{' '}
              <span className="hero__line">
                <span className="hero__accent">Printed</span> to Last.
              </span>
            </h1>
            <p className="hero__lead">
              Game cases, gifts, desk gear &amp; more — designed and 3D printed with care in
              Michigan.
            </p>
            <div className="hero__actions">
              <Link href="/shop/" className="button">
                Shop Now
              </Link>
              <Link href="/about/" className="button button--on-photo">
                Our Story
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="featured-heading">
        <div className="container">
          <div className="section__header">
            <h2 id="featured-heading">Featured</h2>
            <Link href="/shop/">View all products</Link>
          </div>
          <ul className="product-grid">
            {products.map((product) => (
              <li key={product.id}>
                <ProductCard product={product} />
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="section" id="how-it-works" aria-labelledby="how-heading">
        <div className="container">
          <h2 id="how-heading">How personalization works</h2>
          <ol className="steps">
            {steps.map((step) => (
              <li key={step.title}>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </>
  );
}
