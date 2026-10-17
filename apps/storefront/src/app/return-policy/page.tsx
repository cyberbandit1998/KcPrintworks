import type { Metadata } from 'next';
import Link from 'next/link';
import { Breadcrumbs } from '@/components/Breadcrumbs';

// The tab title comes out as "Return & Exchange Policy | KCPrintWorks" through the site title template (app/layout.tsx).
export const metadata: Metadata = {
  title: 'Return & Exchange Policy',
  description:
    'All KCPrintWorks sales are final. Read how exchanges work for unused standard products, and how we replace anything that arrives damaged, defective or incorrect.',
  alternates: { canonical: '/return-policy/' },
};

/** Where every request in this policy starts: the Contact page (the storefront has no form of its own). */
const CONTACT = '/contact/';

export default function ReturnPolicyPage() {
  return (
    <>
      <Breadcrumbs items={[{ name: 'Home', href: '/' }, { name: 'Returns & Exchanges' }]} />
      <div className="container">
        <article className="managed-page">
          <h1>Return &amp; Exchange Policy</h1>

          <section className="notice" aria-labelledby="policy-summary">
            <h2 id="policy-summary">The short version</h2>
            <ul>
              <li>All sales are final. We do not give refunds if you change your mind.</li>
              <li>
                Unused standard products can be exchanged within 30 days of delivery. Contact us
                first.
              </li>
              <li>
                Personalized and custom-designed products cannot be exchanged if you change your
                mind.
              </li>
              <li>
                Damaged, defective or incorrect products: tell us within 30 days of delivery. Once
                we verify the issue, we replace the product at no additional charge and cover all
                necessary shipping costs.
              </li>
            </ul>
          </section>

          <div className="prose content">
            <h2 id="final-sale">All sales are final</h2>
            <p>
              All sales are final. We do not accept returns for a refund when you change your mind.
              This does not affect the rights described in{' '}
              <a href="#your-rights">Your legal and consumer rights</a> below.
            </p>

            <h2 id="exchanges">Exchanges for standard products</h2>
            <p>
              You may request an exchange for an eligible, unused standard product within 30 days of
              delivery.
            </p>
            <ul>
              <li>
                <strong>Contact us first.</strong> You must contact KCPrintWorks through the{' '}
                <Link href={CONTACT}>Contact page</Link> before you ship anything. Tell us your
                order number and what you would like instead, and we will reply with what to do
                next.
              </li>
              <li>
                <strong>Shipping.</strong> For a voluntary exchange, which is one that is not for a
                damaged, defective or incorrect product, you pay the shipping costs in both
                directions: sending the item to us and sending the exchange to you.
              </li>
              <li>
                <strong>No restocking fees.</strong> We never charge a restocking fee.
              </li>
            </ul>

            <h2 id="personalized">Personalized and custom-designed products</h2>
            <p>
              Personalized and custom-designed products are made for you, so they cannot be
              exchanged if you change your mind.
            </p>
            <p>
              This only concerns a change of mind. If one of these products arrives damaged,
              defective or incorrect, the next section applies to it as it does to any other
              product.
            </p>

            <h2 id="problems">Damaged, defective or incorrect products</h2>
            <p>
              If your order arrives damaged, defective or incorrect, please report it within 30 days
              of delivery through the <Link href={CONTACT}>Contact page</Link>. Include your order
              number and, if you can, clear photos of the product and its packaging, so we can
              verify the issue.
            </p>
            <p>
              When we verify the issue, you qualify for a free replacement at no additional charge.
              KCPrintWorks covers all necessary shipping costs, and you may not need to return the
              original item.
            </p>
            <p>
              If we cannot provide a replacement, we will offer an appropriate resolution. That
              includes a refund when it is necessary or required by law.
            </p>
            <p>The 30-day reporting window does not limit any legal rights that apply to you.</p>

            <h2 id="your-rights">Your legal and consumer rights</h2>
            <p>
              This policy does not limit any consumer rights or other legal rights that apply to
              you.
            </p>

            <h2 id="contact">Questions?</h2>
            <p>Please ask before you buy or before you ship anything. We are happy to help.</p>
          </div>

          <div className="contact-actions">
            <Link href={CONTACT} className="button">
              Contact Us
            </Link>
          </div>
        </article>
      </div>
    </>
  );
}
