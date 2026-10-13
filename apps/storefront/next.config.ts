import type { NextConfig } from 'next';

/**
 * SITE_ENV controls indexing. Only `production` is indexable; staging, previews, and local builds send
 * `X-Robots-Tag: noindex` and a disallow-all robots.txt so unfinished work can never be indexed.
 */
const isProduction = process.env.SITE_ENV === 'production';

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  // Strict CSP with nonces is a Step 10 item (see PROJECT_STATUS known issues).
  ...(isProduction ? [] : [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }]),
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Match WooCommerce's trailing-slash URLs so existing links need no redirect (MIGRATION §5).
  trailingSlash: true,
  transpilePackages: ['@kcpw/contracts'],
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
