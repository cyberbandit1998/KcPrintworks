import Link from 'next/link';
import type { Category } from '@kcpw/contracts';
import { NavLink } from './NavLink';
import { CartLink } from './CartLink';

export function SiteHeader({ categories }: { categories: Category[] }) {
  return (
    <header className="site-header">
      <div className="container site-header__inner">
        <Link href="/" className="brand">
          <span className="brand__mark" aria-hidden="true">
            KC
          </span>
          <span>KCPrintWorks</span>
        </Link>
        <nav className="site-nav" aria-label="Main">
          <ul>
            <li>
              <NavLink href="/shop/">Shop</NavLink>
            </li>
            {categories.map((category) => (
              <li key={category.slug}>
                <NavLink href={`/product-category/${category.slug}/`}>{category.name}</NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <CartLink />
      </div>
    </header>
  );
}
