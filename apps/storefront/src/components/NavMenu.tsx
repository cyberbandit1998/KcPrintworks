'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import type { NavItem } from '@/lib/nav';
import { NavLink } from './NavLink';

/**
 * The header links on narrow screens: a native <details> disclosure, so the menu opens and closes with no JavaScript at all and is
 * announced as an expandable button. This small island only closes it after a link is followed and on Escape (focus returns to
 * the button). On wide screens the inline list in SiteHeader is shown instead and this one is hidden.
 */
export function NavMenu({ items }: { items: NavItem[] }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    ref.current?.removeAttribute('open');
  }, [pathname]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const menu = ref.current;
      if (event.key !== 'Escape' || !menu?.open) return;
      menu.open = false;
      menu.querySelector('summary')?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <details ref={ref} className="site-nav__menu">
      <summary>
        <span>Menu</span>
      </summary>
      <ul>
        {items.map((item) => (
          <li key={item.key}>
            <NavLink href={item.href}>{item.label}</NavLink>
          </li>
        ))}
      </ul>
    </details>
  );
}
