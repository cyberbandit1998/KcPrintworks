import type { Metadata } from 'next';
import Link from 'next/link';
import { Breadcrumbs } from '@/components/Breadcrumbs';

export const metadata: Metadata = {
  title: 'Our Story',
  // Not a real page yet: keep it out of search results until the owner's text is in.
  robots: { index: false, follow: true },
};

export default function AboutPage() {
  return (
    <>
      <Breadcrumbs items={[{ name: 'Home', href: '/' }, { name: 'Our Story' }]} />
      <div className="container prose">
        <h1>Our Story</h1>
        <p>
          Placeholder page for design review. The real story is carried over from kcprintworks.com
          when the owner supplies or approves the text.
        </p>
        <p>
          <Link href="/shop/">Shop all products</Link>
        </p>
      </div>
    </>
  );
}
