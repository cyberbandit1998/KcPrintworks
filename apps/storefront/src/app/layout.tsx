import type { Metadata, Viewport } from 'next';
import '@/styles/tokens.css';
import '@/styles/base.css';
import '@/styles/components.css';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import { getCatalog } from '@/lib/catalog';
import { currentCheckoutStatus } from '@/lib/checkout';
import { catalogSourceName, isProduction, siteUrl } from '@/lib/env';
import { SITE_NAME } from '@/lib/seo';

/**
 * Rendered per request. The catalog comes from WooCommerce at run time (cached in memory, see lib/catalog/woo), so a page
 * must not be frozen into the image at build time: a product saved in WooCommerce has to appear without a rebuild.
 * Staging/production behavior (noindex, canonical host) is still fixed at build time; see next.config.ts.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: `${SITE_NAME}: personalized, made-to-order prints`,
    template: `%s | ${SITE_NAME}`,
  },
  description: 'Personalized, made-to-order prints and goods from KCPrintWorks.',
  robots: isProduction ? { index: true, follow: true } : { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#F3EBDD',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // If the catalog cannot be loaded (WooCommerce down before anything was cached), still draw the page frame;
  // the page itself reports the problem through error.tsx.
  const categories = await getCatalog()
    .listCategories()
    .catch(() => []);
  return (
    <html lang="en">
      <body>
        {!isProduction ? (
          <div className="env-banner" role="note">
            {catalogSourceName === 'export' ? (
              <p>
                Design preview built from your product export: real titles, prices, and options. Web
                addresses are derived, and personalization fields are proposed. Not a live store.
              </p>
            ) : catalogSourceName === 'woo' ? (
              <p>
                {currentCheckoutStatus().enabled
                  ? 'Staging preview with the products from your WooCommerce store. Checkout is for testing only: use Stripe test cards, never a real card. Not a live store.'
                  : 'Staging preview with the products from your WooCommerce store, read-only. Checkout is not connected, so nothing can be ordered here. Not a live store.'}
              </p>
            ) : (
              <p>Design preview with placeholder products and content. Not a live store.</p>
            )}
          </div>
        ) : null}
        <a className="skip-link" href="#main">
          Skip to main content
        </a>
        <SiteHeader categories={categories} />
        <main id="main" tabIndex={-1}>
          {children}
        </main>
        <SiteFooter categories={categories} />
      </body>
    </html>
  );
}
