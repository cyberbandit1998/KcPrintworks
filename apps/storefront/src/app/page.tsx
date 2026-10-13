import Link from 'next/link';
import { toSummary } from '@kcpw/contracts';
import { JsonLd } from '@/components/JsonLd';
import { ProductCard } from '@/components/ProductCard';
import { getCatalog } from '@/lib/catalog';
import { organizationJsonLd } from '@/lib/seo';

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
        <div className="container hero__grid">
          <div>
            <span className="hero__eyebrow">Made to order</span>
            <h1 id="hero-heading">Prints and goods made personal.</h1>
            <p className="hero__lead">
              Choose what you love, add your own details, and we make it for you. (Placeholder
              headline for design review.)
            </p>
            <div className="hero__actions">
              <Link href="/shop/" className="button">
                Shop all products
              </Link>
              <Link href="#how-it-works" className="button button--secondary">
                How it works
              </Link>
            </div>
          </div>
          <div className="hero__art" aria-hidden="true">
            <span />
            <span />
            <span />
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
