import type { Metadata } from 'next';
import { CartView, type HandoffNotice } from '@/components/CartView';
import { currentCheckoutStatus } from '@/lib/checkout';

export const metadata: Metadata = {
  title: 'Your cart',
  robots: { index: false, follow: true },
};

const NOTICES: readonly HandoffNotice[] = ['changed', 'expired', 'unavailable'];

/**
 * `?handoff=...` is where the shop host sends a shopper back when their checkout link could not be used. Only the three
 * known words are honored; anything else in the address is ignored.
 */
export default async function CartPage({
  searchParams,
}: {
  searchParams: Promise<{ handoff?: string | string[] }>;
}) {
  const { handoff } = await searchParams;
  const word = Array.isArray(handoff) ? handoff[0] : handoff;
  const notice = NOTICES.find((n) => n === word);
  return <CartView checkoutEnabled={currentCheckoutStatus().enabled} handoffNotice={notice} />;
}
