import Link from 'next/link';
import type { NavItem } from '@/lib/nav';
import { NavLink } from './NavLink';
import { NavMenu } from './NavMenu';
import { CartLink } from './CartLink';
import { SiteSearch } from './SiteSearch';

/**
 * Wide screens (60em and up) show the links inline; narrower ones show a Menu disclosure. Both lists hold the same links, and only
 * one is ever displayed, so assistive technology reads one set. The search button and the cart link and count are always visible.
 */
export function SiteHeader({ nav }: { nav: NavItem[] }) {
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
          <ul className="site-nav__inline">
            {nav.map((item) => (
              <li key={item.key}>
                <NavLink href={item.href}>{item.label}</NavLink>
              </li>
            ))}
          </ul>
          <NavMenu items={nav} />
        </nav>
        <div className="site-header__actions">
          <SiteSearch />
          <CartLink />
        </div>
      </div>
    </header>
  );
}
