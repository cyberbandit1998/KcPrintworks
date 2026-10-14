'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import {
  MAX_LINE_QUANTITY,
  formatMoney,
  lineKey,
  type QuoteResponse,
} from '@kcpw/contracts/client';
import { cartActions, useCartLines } from '@/lib/cart/store';
import {
  estimateItemsSubtotal,
  freeShippingProgress,
  type FreeShippingRule,
} from '@/lib/free-shipping';
import { useIsClient } from '@/lib/use-is-client';
import { FreeShippingProgress } from './FreeShippingProgress';
import { ProductImage } from './ProductImage';

type QuoteResult = { requestKey: string; quote?: QuoteResponse; failed?: boolean };

/** Why the shop host sent the shopper back to the cart (see app/cart/page.tsx). */
export type HandoffNotice = 'changed' | 'expired' | 'unavailable';

const NOTICE_TEXT: Record<HandoffNotice, string> = {
  changed:
    'Something in your cart changed while we were preparing checkout (a price, the stock, or an option). Your cart is kept. Please review it, then press Checkout again.',
  expired: 'Your checkout link expired or was already used. Press Checkout to start again.',
  unavailable:
    'One of your items could not be added to checkout. Your cart is kept. Please review it and try again.',
};

type CheckoutState =
  { phase: 'idle' } | { phase: 'working' } | { phase: 'error'; message: string; details: string[] };

const ERROR_TEXT: Record<string, string> = {
  invalid_lines: 'Some items cannot be ordered right now:',
  changed: NOTICE_TEXT.changed,
  invalid_request: 'We could not read your cart. Please reload the page and try again.',
  checkout_disabled: 'Checkout is not available right now.',
  unavailable:
    'Checkout is not reachable right now. Your cart is kept; please try again in a moment.',
};

function isWebAddress(address: string): boolean {
  try {
    const url = new URL(address);
    return url.protocol === 'https:' || url.protocol === window.location.protocol;
  } catch {
    return false;
  }
}

export function CartView({
  checkoutEnabled = false,
  handoffNotice,
  freeShipping = null,
}: {
  checkoutEnabled?: boolean;
  handoffNotice?: HandoffNotice;
  /** The shop's free-shipping minimum, or null for no progress bar. Display only; WooCommerce decides at checkout. */
  freeShipping?: FreeShippingRule | null;
}) {
  const isClient = useIsClient();
  const lines = useCartLines();
  const [result, setResult] = useState<QuoteResult | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [checkout, setCheckout] = useState<CheckoutState>({ phase: 'idle' });
  // Set synchronously on the first press, so two presses inside one render cannot send two requests.
  const checkoutInFlight = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const focusHeadingAfterRender = useRef(false);

  // After a removal, move focus to whichever heading is on screen once the new cart has rendered
  // (the old heading may be unmounting, e.g. when the last item is removed).
  const linesVersion = JSON.stringify(useCartLines());
  useEffect(() => {
    if (!focusHeadingAfterRender.current) return;
    focusHeadingAfterRender.current = false;
    headingRef.current?.focus();
  }, [linesVersion]);

  // One request per distinct cart. State is only set from the async callbacks, never synchronously in the
  // effect, and the previous quote stays visible while a new one loads (no flicker when quantity changes).
  const requestKey = JSON.stringify(lines);
  useEffect(() => {
    if (!isClient || lines.length === 0) return;
    const controller = new AbortController();
    fetch('/api/cart/quote/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lines }),
      signal: controller.signal,
    })
      .then((response) =>
        response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`)),
      )
      .then(async (data) => {
        // The validation library is loaded here, after the cart has rendered, so it never weighs on
        // the first paint of the cart page or on any other page.
        const { QuoteResponseSchema } = await import('@kcpw/contracts');
        const parsed = QuoteResponseSchema.safeParse(data);
        if (!parsed.success) throw new Error('Unexpected quote response');
        if (!controller.signal.aborted) setResult({ requestKey, quote: parsed.data });
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setResult((prev) => ({ requestKey, quote: prev?.quote, failed: true }));
      });
    return () => controller.abort();
  }, [lines, isClient, requestKey]);

  async function startCheckout() {
    if (checkoutInFlight.current) return;
    checkoutInFlight.current = true;
    setCheckout({ phase: 'working' });
    let leaving = false;
    try {
      const response = await fetch('/api/cart/handoff/', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ lines }),
      });
      const data: unknown = await response.json();
      const body = (typeof data === 'object' && data !== null ? data : {}) as {
        ok?: unknown;
        redirectUrl?: unknown;
        error?: unknown;
        lines?: { index?: number; issues?: { message?: string }[] }[];
      };
      if (body.ok === true && typeof body.redirectUrl === 'string') {
        // The server already accepted this address (the shop's own front page with one single-use token). This only keeps a
        // malformed or non-web address from ever being navigated to. When leaving, the lock and the "working" phase stay on
        // so the button cannot be pressed again while the browser changes page.
        if (isWebAddress(body.redirectUrl)) {
          leaving = true;
          window.location.assign(body.redirectUrl);
          return;
        }
        setCheckout({ phase: 'error', message: ERROR_TEXT.unavailable!, details: [] });
        return;
      }
      const code = typeof body.error === 'string' ? body.error : 'unavailable';
      const details = (body.lines ?? []).flatMap((line) =>
        (line.issues ?? []).map((issue) => {
          const name = quote?.lines[line.index ?? -1]?.name;
          return name ? `${name}: ${issue.message ?? ''}` : (issue.message ?? '');
        }),
      );
      setCheckout({
        phase: 'error',
        message: ERROR_TEXT[code] ?? ERROR_TEXT.unavailable!,
        details,
      });
    } catch {
      setCheckout({ phase: 'error', message: ERROR_TEXT.unavailable!, details: [] });
    } finally {
      if (!leaving) checkoutInFlight.current = false;
    }
  }

  const quote = lines.length > 0 ? (result?.quote ?? null) : null;
  const failed = lines.length > 0 && result?.requestKey === requestKey && result.failed === true;

  if (!isClient) {
    return (
      <div className="container empty-state">
        <p>Loading your cart…</p>
      </div>
    );
  }

  if (lines.length === 0) {
    return (
      <div className="container empty-state">
        <h1 ref={headingRef} tabIndex={-1}>
          Your cart is empty
        </h1>
        <p>Browse the shop and personalize something you like.</p>
        <Link href="/shop/" className="button">
          Shop all products
        </Link>
        <div role="status" aria-live="polite" className="visually-hidden">
          {announcement}
        </div>
      </div>
    );
  }

  const hasIssues =
    (quote?.issues.length ?? 0) > 0 || (quote?.lines.some((l) => l.issues.length > 0) ?? false);

  // Free-shipping progress. Items only (the quote has no shipping in it), from the same prices as the Subtotal row. When the
  // quote is for an older cart, the total is re-worked from its unit prices so quantity changes show at once. When the answer is
  // not accurate (prices failed, an item has a problem, a discount that no longer matches the cart), nothing is shown or promised.
  const quoteIsCurrent = result?.requestKey === requestKey;
  const progressStatus = (() => {
    if (!freeShipping || !quote || failed || hasIssues) return null;
    if (!quoteIsCurrent && (quote.discount?.amount ?? 0) > 0) return null;
    const subtotal = quoteIsCurrent
      ? quote.subtotal
      : estimateItemsSubtotal(
          lines.map((line) => ({ key: lineKey(line), quantity: line.quantity })),
          quote.lines,
        );
    if (!subtotal) return null;
    return freeShippingProgress({
      rule: freeShipping,
      subtotal,
      discount: quoteIsCurrent ? quote.discount : undefined,
      reliable: true,
    });
  })();
  // Until the first prices arrive a neutral placeholder holds the space, so the cart does not jump.
  const showProgress =
    freeShipping !== null && !failed && !hasIssues && (progressStatus !== null || quote === null);

  return (
    <div className="container">
      <div className="page-header">
        <h1 ref={headingRef} tabIndex={-1}>
          Your cart
        </h1>
      </div>
      {handoffNotice ? (
        <div className="notice" role="alert">
          <p>{NOTICE_TEXT[handoffNotice]}</p>
        </div>
      ) : null}
      <div role="status" aria-live="polite" className="visually-hidden">
        {announcement}
      </div>
      <div className={showProgress ? 'cart-layout cart-layout--progress' : 'cart-layout'}>
        {showProgress ? <FreeShippingProgress status={progressStatus} /> : null}
        <section className="cart-items" aria-label="Items in your cart">
          <ul className="cart-lines">
            {lines.map((line, index) => {
              const key = lineKey(line);
              const priced = quote?.lines.find((l) => l.key === key);
              const name = priced?.name ?? 'Loading item…';
              const qtyId = `cart-qty-${index}`;
              return (
                <li className="cart-line" key={key}>
                  <div className="cart-line__image">
                    {priced?.image ? (
                      <ProductImage image={{ id: 0, ...priced.image }} alt="" sizes="112px" />
                    ) : null}
                  </div>
                  <div className="cart-line__details">
                    <h3>
                      {priced?.slug ? <Link href={`/product/${priced.slug}/`}>{name}</Link> : name}
                    </h3>
                    {priced?.variationLabel ? (
                      <p className="pdp__note">{priced.variationLabel}</p>
                    ) : null}
                    {priced && priced.optionSummary.length > 0 ? (
                      <ul className="cart-line__options" aria-label={`Personalization for ${name}`}>
                        {priced.optionSummary.map((item) => (
                          <li key={item.fieldId}>
                            <strong>{item.label}:</strong> {item.value}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {priced?.issues.map((issue) => (
                      <p className="field__error" key={issue.code + (issue.field ?? '')}>
                        {issue.message}
                      </p>
                    ))}
                    <div className="cart-line__actions">
                      <div className="field" style={{ marginBottom: 0 }}>
                        <label className="field__label" htmlFor={qtyId}>
                          Quantity<span className="visually-hidden"> for {name}</span>
                        </label>
                        <input
                          id={qtyId}
                          className="input qty"
                          type="number"
                          inputMode="numeric"
                          min={1}
                          max={MAX_LINE_QUANTITY}
                          value={line.quantity}
                          onChange={(e) => {
                            const next = Number(e.target.value);
                            if (Number.isFinite(next) && next >= 1)
                              cartActions.setQuantity(key, next);
                          }}
                        />
                      </div>
                      <button
                        type="button"
                        className="link-button"
                        onClick={() => {
                          focusHeadingAfterRender.current = true;
                          cartActions.remove(key);
                          setAnnouncement(`${name} removed from your cart.`);
                        }}
                      >
                        Remove<span className="visually-hidden"> {name}</span>
                      </button>
                    </div>
                  </div>
                  <p className="cart-line__total">
                    {priced ? (
                      <>
                        <span className="visually-hidden">Line total: </span>
                        {formatMoney(priced.lineTotal)}
                      </>
                    ) : (
                      '…'
                    )}
                  </p>
                </li>
              );
            })}
          </ul>
        </section>

        <aside className="summary" aria-labelledby="summary-heading">
          <h2 id="summary-heading">Order summary</h2>
          <dl>
            <dt>Subtotal</dt>
            <dd>{quote ? formatMoney(quote.subtotal) : failed ? 'Unavailable' : '…'}</dd>
          </dl>
          <p className="pdp__note">
            {quote?.note ?? 'Shipping and tax are calculated at checkout.'}
          </p>
          {failed ? (
            <p className="field__error" role="alert">
              We could not update your prices. Check your connection and try again.
            </p>
          ) : null}
          {hasIssues ? (
            <p className="field__error">Fix the items marked above before checking out.</p>
          ) : null}
          {checkoutEnabled ? (
            <>
              <button
                type="button"
                className="button"
                aria-disabled={hasIssues || !quote || checkout.phase === 'working'}
                aria-describedby="checkout-status"
                onClick={() => {
                  if (!hasIssues && quote) void startCheckout();
                }}
              >
                {checkout.phase === 'working' ? 'Preparing checkout…' : 'Checkout'}
              </button>
              <div id="checkout-status" role="status" aria-live="polite">
                {checkout.phase === 'working' ? (
                  <p className="pdp__note">Taking you to secure checkout…</p>
                ) : null}
              </div>
              {checkout.phase === 'error' ? (
                <div className="notice" role="alert">
                  <p>{checkout.message}</p>
                  {checkout.details.length > 0 ? (
                    <ul>
                      {checkout.details.map((detail) => (
                        <li key={detail}>{detail}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : (
            <>
              <button
                type="button"
                className="button"
                aria-disabled="true"
                aria-describedby="checkout-note"
              >
                Checkout
              </button>
              <p className="pdp__note" id="checkout-note">
                Online checkout is not open on this site yet.
              </p>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
