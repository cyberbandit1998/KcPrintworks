import type { Metadata, Viewport } from 'next';
import '@/styles/tokens.css';
import '@/styles/base.css';
import '@/styles/components.css';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import { getCatalog } from '@/lib/catalog';
import { isProduction, siteUrl } from '@/lib/env';
import { SITE_NAME } from '@/lib/seo';

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
  const categories = await getCatalog().listCategories();
  return (
    <html lang="en">
      <body>
        {!isProduction ? (
          <div className="env-banner" role="note">
            <p>Design preview with placeholder products and content. Not a live store.</p>
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
