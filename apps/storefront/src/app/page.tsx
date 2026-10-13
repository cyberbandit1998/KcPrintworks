import Image from 'next/image';
import Link from 'next/link';
import { toSummary } from '@kcpw/contracts';
import { JsonLd } from '@/components/JsonLd';
import { ProductCard } from '@/components/ProductCard';
import { getCatalog } from '@/lib/catalog';
import { organizationJsonLd } from '@/lib/seo';

/** The owner's banner photograph. Replace the file, keep the path. */
const HERO_IMAGE = '/images/hero-banner.jpg';

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
        {/* Decorative: the headline and buttons are real text, so the photo needs no description. */}
        <Image
          className="hero__photo"
          src={HERO_IMAGE}
          alt=""
          fill
          priority
          sizes="100vw"
          unoptimized={HERO_IMAGE.endsWith('.svg')}
        />
        <div className="container hero__content">
          <div className="hero__text">
            <h1 id="hero-heading">
              Michigan Made. <span className="hero__accent">Printed</span> to Last.
            </h1>
            <p className="hero__lead">
              Game cases, gifts, desk gear &amp; more — designed and 3D printed with care in
              Michigan.
            </p>
            <div className="hero__actions">
              <Link href="/shop/" className="button">
                Shop now <span aria-hidden="true">→</span>
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
