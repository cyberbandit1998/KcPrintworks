import { siteEnv } from '@/lib/env';

/**
 * Liveness check for Docker and the reverse proxy. It must never call WooCommerce, Stripe, or any other
 * upstream: an outage there must not make the storefront container look dead and trigger restarts.
 */
export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json(
    { status: 'ok', siteEnv, version: process.env.APP_VERSION ?? 'dev' },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
