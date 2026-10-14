import path from 'node:path';
import type { NextConfig } from 'next';
import { parseImageHosts } from './src/lib/image-hosts';

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

/**
 * `NEXT_OUTPUT=standalone` is set only by the Docker build (see Dockerfile). It makes `next build` emit a
 * self-contained server in `.next/standalone`; regular builds, tests, and `next start` are unaffected.
 *
 * SITE_ENV and NEXT_PUBLIC_SITE_URL are read at BUILD time: pages are prerendered, so the robots meta tag,
 * robots.txt, and canonical URLs are baked in, and the X-Robots-Tag header above is written into the routes
 * manifest. An image therefore is either a staging image (noindex, the default) or a production image.
 */
const standalone = process.env.NEXT_OUTPUT === 'standalone';
const imageHosts = parseImageHosts(process.env.IMAGE_HOSTS);

const nextConfig: NextConfig = {
  reactStrictMode: true,
  ...(standalone ? { output: 'standalone' as const } : {}),
  // This is an npm workspace: trace dependencies from the repository root so the standalone output
  // includes packages/contracts and the hoisted node_modules.
  outputFileTracingRoot: path.resolve(process.cwd(), '../..'),
  // The design-preview source can read the owner's product export from docs/discovery. Never ship that folder in a build output.
  outputFileTracingExcludes: { '/*': ['../../docs/discovery/**/*'] },
  poweredByHeader: false,
  // Match WooCommerce's trailing-slash URLs so existing links need no redirect (MIGRATION §5).
  trailingSlash: true,
  transpilePackages: ['@kcpw/contracts'],
  // Pages are rendered per request now (the catalog is read from WooCommerce at run time), so a runtime environment
  // variable could otherwise change what an image was built to be. These are written into the build: a staging image
  // stays noindex whatever the VPS .env says, and the optimizer's host list cannot be widened from outside.
  env: {
    SITE_ENV: process.env.SITE_ENV ?? '',
    IMAGE_HOSTS: imageHosts.join(','),
  },
  images: {
    remotePatterns: imageHosts.map((hostname) => ({ protocol: 'https' as const, hostname })),
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
