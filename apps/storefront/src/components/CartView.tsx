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
import { checkoutAvailable } from '@/lib/checkout';
import { useIsClient } from '@/lib/use-is-client';
import { ProductImage } from './ProductImage';

type QuoteResult = { requestKey: string; quote?: QuoteResponse; failed?: boolean };

export function CartView() {
  const isClient = useIsClient();
  const lines = useCartLines();
  const [result, setResult] = useState<QuoteResult | null>(null);
  const [announcement, setAnnouncement] = useState('');
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

  return (
    <div className="container">
      <div className="page-header">
        <h1 ref={headingRef} tabIndex={-1}>
          Your cart
        </h1>
      </div>
      <div role="status" aria-live="polite" className="visually-hidden">
        {announcement}
      </div>
      <div className="cart-layout">
        <section aria-label="Items in your cart">
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
          {checkoutAvailable ? (
            <Link href="/checkout/" className="button">
              Checkout
            </Link>
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
                Checkout is not connected in this design preview. It arrives in the next build
                phase.
              </p>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
