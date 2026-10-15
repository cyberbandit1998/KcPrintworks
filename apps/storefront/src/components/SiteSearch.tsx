'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import { formatMoney } from '@kcpw/contracts/client';
import type { SearchHitDto } from '@/lib/search/hit';
import { quoteHref, searchHref } from '@/lib/search/url';
import { ProductImage } from './ProductImage';

/**
 * The search box in the header. It is a native <details> disclosure holding a real GET form to /search/, so it opens, takes a
 * query and finds results with no JavaScript at all. JavaScript adds the live list: a debounced request to /api/search/ (answered
 * from the catalog held in memory), arrow-key navigation (the ARIA combobox pattern: focus stays in the input, the active row is named by
 * aria-activedescendant), Enter to open the active row, Escape to close and return focus to the button, and a polite status line.
 */
const MIN_CHARS = 2;
const DEBOUNCE_MS = 160;

interface Found {
  query: string;
  total: number;
  hits: SearchHitDto[];
}

export function SiteSearch() {
  const router = useRouter();
  const pathname = usePathname();
  const baseId = useId();
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<Found | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState(-1);
  const listId = `${baseId}-results`;
  const statusId = `${baseId}-status`;

  const close = (returnFocus: boolean) => {
    const details = detailsRef.current;
    if (!details?.open) return;
    details.open = false;
    setActive(-1);
    if (returnFocus) details.querySelector('summary')?.focus();
  };

  // Follow a link, a result or the browser's back button: the panel closes and starts clean.
  useEffect(() => {
    detailsRef.current?.removeAttribute('open');
    const reset = window.setTimeout(() => {
      setQuery('');
      setFound(null);
      setFailed(false);
      setActive(-1);
    }, 0);
    return () => window.clearTimeout(reset);
  }, [pathname]);

  // A click or tap anywhere else closes the panel.
  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      const details = detailsRef.current;
      if (details?.open && event.target instanceof Node && !details.contains(event.target)) {
        details.open = false;
      }
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, []);

  // The live list.
  useEffect(() => {
    const text = query.trim();
    if (text.length < MIN_CHARS) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/search/?q=${encodeURIComponent(text)}&limit=6`, {
          signal: controller.signal,
          headers: { accept: 'application/json' },
        });
        if (!response.ok) throw new Error(String(response.status));
        const body = (await response.json()) as { total: number; hits: SearchHitDto[] };
        setFound({ query: text, total: body.total, hits: body.hits });
        setFailed(false);
        setActive(-1);
        setLoading(false);
      } catch (error) {
        if ((error as { name?: string }).name !== 'AbortError') {
          setFailed(true);
          setLoading(false);
        }
      }
    }, DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  // Results are kept on screen while the next ones load; a query that is too short shows none.
  const searching = query.trim().length >= MIN_CHARS;
  const current = searching ? found : null;
  const hits = current ? current.hits : [];
  // The last row is "View all results"; a list with no products has no rows at all.
  const rows = hits.length > 0 ? hits.length + 1 : 0;
  const optionId = (i: number) => `${baseId}-option-${i}`;

  const go = (href: string) => {
    close(false);
    router.push(href);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
      return;
    }
    if (rows === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((i) => (i + 1) % rows);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((i) => (i <= 0 ? rows - 1 : i - 1));
    } else if (event.key === 'Enter' && active >= 0) {
      event.preventDefault();
      const hit = hits[active];
      go(hit ? `/product/${hit.slug}/` : searchHref({ q: query.trim() }));
    }
  };

  const status = !searching
    ? ''
    : failed
      ? 'Search is not available right now. Press Enter to search the shop instead.'
      : loading && !current
        ? 'Searching…'
        : current
          ? current.total === 0
            ? `No products found for “${current.query}”.`
            : `${current.total} ${current.total === 1 ? 'result' : 'results'}. Use the up and down arrow keys to choose, then Enter.`
          : '';

  return (
    <details
      ref={detailsRef}
      className="site-search"
      onToggle={(event) => {
        if (event.currentTarget.open) inputRef.current?.focus();
      }}
    >
      <summary className="site-search__button" aria-label="Search">
        <svg
          className="site-search__icon"
          viewBox="0 0 24 24"
          width="22"
          height="22"
          aria-hidden="true"
          focusable="false"
        >
          <circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" strokeWidth="2.4" />
          <path
            d="m15.5 15.5 5 5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
          />
        </svg>
      </summary>
      <div className="site-search__panel">
        <form
          action="/search/"
          method="get"
          role="search"
          className="site-search__form"
          onSubmit={(event) => {
            // Enter on a highlighted row is handled in onKeyDown; a plain submit goes to the results page through the router.
            event.preventDefault();
            const text = query.trim();
            go(searchHref({ q: text }));
          }}
        >
          <label htmlFor={`${baseId}-input`} className="visually-hidden">
            Search products
          </label>
          <input
            ref={inputRef}
            id={`${baseId}-input`}
            className="input site-search__input"
            type="search"
            name="q"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search games, cases, gifts..."
            maxLength={80}
            autoComplete="off"
            enterKeyHint="search"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={rows > 0}
            aria-controls={listId}
            aria-activedescendant={active >= 0 ? optionId(active) : undefined}
          />
          <button type="submit" className="button button--small">
            Search
          </button>
        </form>
        <p id={statusId} className="visually-hidden" role="status" aria-live="polite">
          {status}
        </p>
        <ul
          id={listId}
          className="site-search__list"
          role="listbox"
          aria-label="Search suggestions"
          hidden={rows === 0}
        >
          {hits.map((hit, i) => (
            <li
              key={hit.id}
              id={optionId(i)}
              role="option"
              aria-selected={active === i}
              className="site-search__option"
              data-active={active === i ? 'true' : undefined}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => go(`/product/${hit.slug}/`)}
              onMouseMove={() => setActive(i)}
            >
              <span className="site-search__thumb" aria-hidden="true">
                {hit.image ? (
                  <ProductImage image={{ id: hit.id, ...hit.image, alt: '' }} alt="" sizes="56px" />
                ) : null}
              </span>
              <span className="site-search__text">
                <span className="site-search__name">{hit.name}</span>
                <span className="site-search__meta">
                  {hit.category ? `${hit.category} · ` : ''}
                  {hit.from ? 'From ' : ''}
                  {formatMoney(hit.price)}
                </span>
              </span>
            </li>
          ))}
          {hits.length > 0 && current ? (
            <li
              id={optionId(hits.length)}
              role="option"
              aria-selected={active === hits.length}
              className="site-search__option site-search__option--all"
              data-active={active === hits.length ? 'true' : undefined}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => go(searchHref({ q: query.trim() }))}
              onMouseMove={() => setActive(hits.length)}
            >
              View All Results
              {current.total > hits.length ? ` (${current.total})` : ''}
            </li>
          ) : null}
        </ul>
        {current && current.total === 0 ? (
          <p className="site-search__empty">
            No products match “{current.query}”.{' '}
            <Link href={quoteHref(current.query)}>Can’t find it? Request a Custom Quote</Link>
          </p>
        ) : null}
      </div>
    </details>
  );
}
