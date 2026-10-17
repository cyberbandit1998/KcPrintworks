import Link from 'next/link';
import type { Category } from '@kcpw/contracts/client';
import type { NavItem } from '@/lib/nav';

/** `categories` are the browsable ones (parents before children); only top-level ones are listed here, after the header's own links. */
export function SiteFooter({ nav, categories }: { nav: NavItem[]; categories: Category[] }) {
  const shown = new Set(nav.map((item) => item.href));
  const ids = new Set(categories.map((c) => c.id));
  const others = categories.filter(
    (c) => (c.parentId === 0 || !ids.has(c.parentId)) && !shown.has(`/product-category/${c.slug}/`),
  );
  const shopLinks = nav.filter((item) => item.key !== 'blog' && item.key !== 'shop');
  return (
    <footer className="site-footer">
      <div className="container">
        <div className="footer__grid">
          <div>
            <p className="footer__brand">KCPrintWorks</p>
            <p>
              Michigan-made 3D printed game cases, personalized gifts, and practical storage
              solutions. Made to order with care.
            </p>
          </div>
          <nav aria-labelledby="footer-shop">
            <h2 id="footer-shop">Shop</h2>
            <ul>
              <li>
                <Link href="/shop/">All products</Link>
              </li>
              {shopLinks.map((item) => (
                <li key={item.key}>
                  <Link href={item.href}>{item.label}</Link>
                </li>
              ))}
              {others.map((category) => (
                <li key={category.slug}>
                  <Link href={`/product-category/${category.slug}/`}>{category.name}</Link>
                </li>
              ))}
            </ul>
          </nav>
          <nav aria-labelledby="footer-about">
            <h2 id="footer-about">KCPrintWorks</h2>
            <ul>
              <li>
                <Link href="/our-story/">Our Story</Link>
              </li>
              <li>
                <Link href="/blog/">Blog</Link>
              </li>
              <li>
                <Link href="/contact/">Contact</Link>
              </li>
            </ul>
          </nav>
          <nav aria-labelledby="footer-help">
            <h2 id="footer-help">Your order</h2>
            <ul>
              <li>
                <Link href="/cart/">Cart</Link>
              </li>
              <li>
                <Link href="/return-policy/">Returns &amp; Exchanges</Link>
              </li>
            </ul>
          </nav>
        </div>
        <div className="footer__small">
          <p>&copy; {new Date().getFullYear()} KCPrintWorks</p>
        </div>
      </div>
    </footer>
  );
}
