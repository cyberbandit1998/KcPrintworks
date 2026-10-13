import type { Metadata } from 'next';
import { CartView } from '@/components/CartView';

export const metadata: Metadata = {
  title: 'Your cart',
  robots: { index: false, follow: true },
};

export default function CartPage() {
  return <CartView />;
}
