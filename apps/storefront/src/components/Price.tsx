import { formatMoney, type Money } from '@kcpw/contracts/client';

interface Props {
  price: Money;
  regularPrice?: Money;
  /** Show "From" when the product has several prices (variable products before a choice is made). */
  from?: boolean;
}

export function Price({ price, regularPrice, from = false }: Props) {
  const onSale = regularPrice !== undefined && regularPrice.amount > price.amount;
  return (
    <>
      {from ? <span>From </span> : null}
      <span>{formatMoney(price)}</span>
      {onSale && regularPrice ? (
        <>
          <span className="visually-hidden"> (was </span>
          <del className="price__was">{formatMoney(regularPrice)}</del>
          <span className="visually-hidden">)</span>
        </>
      ) : null}
    </>
  );
}
