import type { Metadata } from 'next';
import Link from 'next/link';
import { Breadcrumbs } from '@/components/Breadcrumbs';
import { QuoteRequestForm } from '@/components/QuoteRequestForm';
import { currentQuotesStatus, QUOTES_EMAIL } from '@/lib/quotes/config';
import { issueQuoteFormToken } from '@/lib/quotes/form-token';
import { cleanQuery } from '@/lib/search/hit';

export const metadata: Metadata = {
  title: 'Request a Custom Quote',
  description:
    'Tell us what you would like made. We will email you a quote with the price, shipping and how long it is valid. Asking is free.',
  alternates: { canonical: '/custom-orders/' },
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const steps = [
  { title: 'Tell us', text: 'Describe what you need and add a picture or two. It is free to ask.' },
  {
    title: 'We send a quote',
    text: 'We email you the price, shipping, details and how long the quote is valid.',
  },
  {
    title: 'You approve',
    text: 'Open the secure link in the email and approve it when you are happy.',
  },
  {
    title: 'Pay and we make it',
    text: 'Pay securely at checkout. We make it to order and ship it.',
  },
];

export default async function CustomOrdersPage({ searchParams }: Props) {
  const status = currentQuotesStatus();
  // What the visitor was looking for (the search page links here with it): shown in the form, where they can change it.
  const item = cleanQuery((await searchParams).item).slice(0, 120);
  return (
    <>
      <Breadcrumbs items={[{ name: 'Home', href: '/' }, { name: 'Request a Custom Quote' }]} />
      <div className="container quote-page">
        <div className="page-header">
          <h1>Request a Custom Quote</h1>
          <p>
            Need something we do not list? Tell us about it and we will quote it. Asking is free and
            you pay nothing until you approve.
          </p>
        </div>
        <ol className="steps quote-steps" aria-label="How custom orders work">
          {steps.map((step) => (
            <li key={step.title}>
              <h2 className="steps__title">{step.title}</h2>
              <p>{step.text}</p>
            </li>
          ))}
        </ol>
        {status.enabled ? (
          <QuoteRequestForm token={issueQuoteFormToken(status.config.secret)} initialItem={item} />
        ) : (
          <section className="notice" aria-labelledby="quote-off-heading">
            <h2 id="quote-off-heading">The request form is not open yet</h2>
            <p>
              For now, email us at{' '}
              <a
                href={`mailto:${QUOTES_EMAIL}?subject=${encodeURIComponent('Custom quote request')}`}
              >
                {QUOTES_EMAIL}
              </a>{' '}
              with what you would like made, how many, and any pictures, and we will reply with a
              quote.
            </p>
            <p>
              <Link href="/shop/">Browse the shop</Link>
            </p>
          </section>
        )}
      </div>
    </>
  );
}
