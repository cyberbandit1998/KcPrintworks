import Link from 'next/link';
import type { ProductSummary } from '@kcpw/contracts';
import { Price } from './Price';
import { ProductImage } from './ProductImage';

export function ProductCard({ product }: { product: ProductSummary }) {
  const image = product.images[0];
  const soldOut = product.availability.stockStatus === 'outofstock';
  const onSale = product.regularPrice && product.regularPrice.amount > product.price.amount;
  return (
    <article className="card">
      {image ? (
        <div className="card__media">
          {/* The product name link right below names the card, so the image is decorative here. */}
          <ProductImage image={image} alt="" sizes="(min-width: 48em) 25vw, 50vw" />
        </div>
      ) : null}
      <div className="card__body">
        <h3 className="card__title">
          <Link href={`/product/${product.slug}/`}>{product.name}</Link>
        </h3>
        <p className="card__price">
          <Price
            price={product.price}
            regularPrice={product.regularPrice}
            from={product.type === 'variable'}
          />
        </p>
        <ul className="badges" aria-label="Product features">
          {product.personalizable ? <li className="badge">Personalized</li> : null}
          {product.availability.madeToOrder ? (
            <li className="badge badge--outline">Made to order</li>
          ) : null}
          {onSale ? <li className="badge badge--outline">Sale</li> : null}
          {soldOut ? <li className="badge badge--outline">Sold out</li> : null}
        </ul>
      </div>
    </article>
  );
}
