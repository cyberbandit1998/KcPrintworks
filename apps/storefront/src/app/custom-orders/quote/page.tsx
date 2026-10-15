import type { Metadata } from 'next';
import Link from 'next/link';
import { formatMoney } from '@kcpw/contracts';
import { QuoteApprovalForm } from '@/components/QuoteApprovalForm';
import { checkShop } from '@/lib/handoff/shop-guard';
import { isProduction, siteUrl } from '@/lib/env';
import type { QuoteView } from '@/lib/quotes/api-types';
import { countryOptions } from '@/lib/quotes/countries';
import {
  currentQuotePaymentStatus,
  currentQuotesStatus,
  QUOTES_EMAIL,
  shopTimeZone,
} from '@/lib/quotes/config';
import { fetchQuoteView } from '@/lib/quotes/view';

// A private page: never indexed, never cached, and it does not tell other sites where the visitor came from (the address holds a secret).
export const metadata: Metadata = {
  title: 'Your quote',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const first = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value[0] : value) ?? '';

const mailto = (subject: string) => `mailto:${QUOTES_EMAIL}?subject=${encodeURIComponent(subject)}`;

function dateText(seconds: number): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: shopTimeZone(),
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(new Date(seconds * 1000));
  } catch {
    return new Date(seconds * 1000).toISOString().slice(0, 10);
  }
}

function Page({ children }: { children: React.ReactNode }) {
  return <div className="container quote-page quote-view">{children}</div>;
}

function Message({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Page>
      <div className="page-header">
        <h1>{title}</h1>
      </div>
      <section className="notice" aria-labelledby="quote-message">
        <h2 id="quote-message" className="visually-hidden">
          {title}
        </h2>
        {children}
      </section>
    </Page>
  );
}

export default async function QuoteLinkPage({ searchParams }: Props) {
  const params = await searchParams;
  const quotes = currentQuotesStatus();
  if (!quotes.enabled) {
    return (
      <Message title="Quotes are not available here yet">
        <p>
          Please <a href={mailto('My custom quote')}>email us at {QUOTES_EMAIL}</a> and we will help
          you.
        </p>
      </Message>
    );
  }
  const result = await fetchQuoteView(quotes.config, first(params.ref), first(params.token));
  if (result.kind === 'invalid_link') {
    return (
      <Message title="This quote link is not valid">
        <p>
          It may have been replaced by a newer quote: please use the link in your most recent email
          from us. If you are not sure, write to{' '}
          <a href={mailto('My custom quote link')}>{QUOTES_EMAIL}</a>.
        </p>
      </Message>
    );
  }
  if (result.kind === 'unavailable') {
    return (
      <Message title="We cannot show your quote right now">
        <p>
          Nothing was changed or charged. Please try again in a little while, or email{' '}
          <a href={mailto('My custom quote')}>{QUOTES_EMAIL}</a>.
        </p>
      </Message>
    );
  }

  const view = result.view;
  const money = (cents: number) => formatMoney({ amount: cents, currency: view.currency });
  const total = money(view.totalCents);

  return (
    <Page>
      <div className="page-header">
        <h1>Your quote</h1>
        <p>
          Reference <strong className="quote-ref">{view.ref}</strong>
          {view.firstName ? <> for {view.firstName}</> : null}
        </p>
      </div>
      <Summary view={view} money={money} total={total} />
      <State view={view} total={total} token={first(params.token)} />
    </Page>
  );
}

function Summary({
  view,
  money,
  total,
}: {
  view: QuoteView;
  money: (c: number) => string;
  total: string;
}) {
  return (
    <section className="quote-summary" aria-labelledby="quote-offer-heading">
      <h2 id="quote-offer-heading">{view.title}</h2>
      <dl className="quote-summary__list">
        {view.project ? (
          <>
            <dt>Project</dt>
            <dd>{view.project}</dd>
          </>
        ) : null}
        <dt>Quantity</dt>
        <dd>{view.quantity}</dd>
        <dt>Item</dt>
        <dd>{money(view.itemCents)}</dd>
        <dt>Shipping</dt>
        <dd>{view.shipCents > 0 ? money(view.shipCents) : 'Free'}</dd>
        <dt>Total</dt>
        <dd>
          <strong>{total}</strong>
          {view.taxable ? ' plus sales tax where it applies, added at payment' : ''}
        </dd>
        {view.state === 'open' ? (
          <>
            <dt>Valid until</dt>
            <dd>{dateText(view.expiresAt)}</dd>
          </>
        ) : null}
      </dl>
      {view.details ? <p className="quote-summary__details">{view.details}</p> : null}
    </section>
  );
}

async function State({ view, total, token }: { view: QuoteView; total: string; token: string }) {
  if (view.state === 'paid') {
    return (
      <section className="notice notice--success" role="status" aria-labelledby="quote-state">
        <h2 id="quote-state">Paid. Thank you!</h2>
        <p>
          We have your payment and will start on your order. WooCommerce has emailed your receipt.
          Questions? Reply to that email and mention {view.ref}.
        </p>
      </section>
    );
  }
  if (view.state === 'expired') {
    return (
      <section className="notice" aria-labelledby="quote-state">
        <h2 id="quote-state">This quote has expired</h2>
        <p>
          Prices and availability can change, so quotes are only valid for a while. Nothing was
          charged. Write to <a href={mailto(`Quote ${view.ref} has expired`)}>{QUOTES_EMAIL}</a> and
          we will send a fresh one.
        </p>
      </section>
    );
  }
  if (view.state === 'closed') {
    return (
      <section className="notice" aria-labelledby="quote-state">
        <h2 id="quote-state">This quote is closed</h2>
        <p>
          Please <a href={mailto(`Quote ${view.ref}`)}>email us</a> if you have a question.
        </p>
      </section>
    );
  }

  // open or approved: both lead to paying, which is checkout, so everything checkout needs must be on, and the shop must agree.
  const payments = currentQuotePaymentStatus();
  let available = false;
  if (payments.enabled) {
    const shop = await checkShop(payments.config, { production: isProduction, siteUrl });
    available = shop.ok;
    if (!shop.ok)
      console.error(`[quotes] quote page: payment not offered (${shop.kind}): ${shop.why}`);
  }
  if (!available) {
    return (
      <section className="notice" aria-labelledby="quote-state">
        <h2 id="quote-state">Online approval is not open yet</h2>
        <p>
          To go ahead with this quote, reply to the email we sent you or write to{' '}
          <a href={mailto(`I would like to approve quote ${view.ref}`)}>{QUOTES_EMAIL}</a>, and we
          will arrange it with you.
        </p>
      </section>
    );
  }
  if (view.state === 'approved') {
    return (
      <section className="notice" aria-labelledby="quote-state">
        <h2 id="quote-state">You approved this quote</h2>
        {view.payUrl ? (
          <>
            <p>
              Pay by {dateText(view.payBy)} to keep it. Your payment is processed securely by Stripe
              through our shop.
            </p>
            <p>
              <a className="button" href={view.payUrl}>
                Continue to payment
              </a>
            </p>
          </>
        ) : (
          <p>
            Payment is not available for it right now. Please{' '}
            <a href={mailto(`Quote ${view.ref}`)}>email us</a> and we will help.
          </p>
        )}
      </section>
    );
  }
  return (
    <section aria-labelledby="quote-approve-heading">
      <h2 id="quote-approve-heading">Approve this quote</h2>
      <p>
        Tell us where to send it and approve. You will then be taken to a secure page to pay {total}
        . You are not charged before that.
      </p>
      <QuoteApprovalForm
        reference={view.ref}
        token={token}
        revision={view.revision}
        totalText={total}
        taxable={view.taxable}
        countries={countryOptions('en')}
      />
      <p className="field__help">
        Not what you expected? <Link href="/custom-orders/">Ask for a different quote</Link>.
      </p>
    </section>
  );
}
