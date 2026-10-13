import Link from 'next/link';
import type { Category } from '@kcpw/contracts';

export function SiteFooter({ categories }: { categories: Category[] }) {
  return (
    <footer className="site-footer">
      <div className="container">
        <div className="footer__grid">
          <div>
            <p className="footer__brand">KCPrintWorks</p>
            <p>
              Personalized, made-to-order prints and goods. (Placeholder tagline for design review.)
            </p>
          </div>
          <nav aria-labelledby="footer-shop">
            <h2 id="footer-shop">Shop</h2>
            <ul>
              <li>
                <Link href="/shop/">All products</Link>
              </li>
              {categories.map((category) => (
                <li key={category.slug}>
                  <Link href={`/product-category/${category.slug}/`}>{category.name}</Link>
                </li>
              ))}
            </ul>
          </nav>
          <nav aria-labelledby="footer-help">
            <h2 id="footer-help">Your order</h2>
            <ul>
              <li>
                <Link href="/cart/">Cart</Link>
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
