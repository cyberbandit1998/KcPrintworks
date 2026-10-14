import type { ProductSummary } from '@kcpw/contracts/client';
import { ProductCard } from './ProductCard';

/** The one product grid used by the shop, category pages, New Arrivals and the home page sections. */
export function ProductGrid({ products }: { products: readonly ProductSummary[] }) {
  return (
    <ul className="product-grid">
      {products.map((product) => (
        <li key={product.id}>
          <ProductCard product={product} />
        </li>
      ))}
    </ul>
  );
}
