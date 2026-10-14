import Link from 'next/link';
import type { ProductSummary } from '@kcpw/contracts/client';
import { ProductGrid } from '../ProductGrid';

/**
 * The products marked Featured (the star) in WooCommerce, in WooCommerce's order, newest first. It shows exactly those products:
 * nothing is added when there are few, and with none the whole section is left out (never filled with other products).
 */
export function FeaturedSection({ products }: { products: readonly ProductSummary[] }) {
  if (products.length === 0) return null;
  return (
    <section className="section" aria-labelledby="featured-heading" data-section="featured">
      <div className="container">
        <div className="section__header">
          <h2 id="featured-heading">Featured Products</h2>
          <Link href="/shop/">View all products</Link>
        </div>
        <ProductGrid products={products} />
      </div>
    </section>
  );
}
