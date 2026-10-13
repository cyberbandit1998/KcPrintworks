'use client';

import Link from 'next/link';
import { cartCount } from '@/lib/cart/cart-state';
import { useCartLines } from '@/lib/cart/store';

export function CartLink() {
  const count = cartCount(useCartLines());
  return (
    <Link href="/cart/" className="cart-link">
      <span>Cart</span>
      <span className="cart-link__count" aria-hidden="true">
        {count}
      </span>
      <span className="visually-hidden">{count === 1 ? '1 item' : `${count} items`}</span>
    </Link>
  );
}
