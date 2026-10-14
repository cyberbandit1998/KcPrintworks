import Link from 'next/link';
import type { ProductSummary } from '@kcpw/contracts/client';
import { ProductGrid } from '../ProductGrid';

/** The most recently published products (by publication date, never by a category). Left out when there are none. */
export function NewArrivalsSection({ products }: { products: readonly ProductSummary[] }) {
  if (products.length === 0) return null;
  return (
    <section className="section" aria-labelledby="new-arrivals-heading" data-section="new-arrivals">
      <div className="container">
        <div className="section__header">
          <h2 id="new-arrivals-heading">New Arrivals</h2>
          <Link href="/new-arrivals/">See all new arrivals</Link>
        </div>
        <ProductGrid products={products} />
      </div>
    </section>
  );
}
