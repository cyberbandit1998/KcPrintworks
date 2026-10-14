import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';
import { WOO_TEST } from './tests/support/woo-test';

/**
 * The sandbox ships a Chromium build that may not match this Playwright version's expected revision, so an
 * explicit executable is used when present. In CI, `npx playwright install chromium` provides the browser.
 */
const localChromium = process.env.PW_CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';
const executablePath = existsSync(localChromium) ? localChromium : undefined;

const PORT = WOO_TEST.mainPort;
// A second storefront on the same build reads a mock WooCommerce store (see tests/support/mock-woo.mjs).
const WOO_PORT = WOO_TEST.port;
const MOCK_WOO_PORT = WOO_TEST.mockPort;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    launchOptions: executablePath ? { executablePath, args: ['--no-sandbox'] } : {},
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      // The image cache is cleared first: Next keeps resized photos for hours keyed by address, so a replaced photo would otherwise be
      // tested against the old pixels.
      command: `node -e "require('fs').rmSync('.next/cache/images',{recursive:true,force:true})" && npm run build && npx next start -p ${PORT}`,
      url: `http://localhost:${PORT}/`,
      reuseExistingServer: !process.env.CI,
      timeout: 240_000,
      env: { SITE_ENV: 'development' },
    },
    {
      command: `node tests/support/mock-woo.mjs ${MOCK_WOO_PORT}`,
      url: `http://127.0.0.1:${MOCK_WOO_PORT}/images/ready.svg`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: `node tests/support/start-after.mjs http://localhost:${PORT}/ ${WOO_PORT}`,
      url: `http://localhost:${WOO_PORT}/api/health/`,
      reuseExistingServer: !process.env.CI,
      timeout: 260_000,
      env: {
        SITE_ENV: 'development',
        CATALOG_SOURCE: 'woo',
        WC_BASE_URL: `http://127.0.0.1:${MOCK_WOO_PORT}`,
        WC_CONSUMER_KEY: 'ck_mock_read_only_key',
        WC_CONSUMER_SECRET: 'cs_mock_read_only_secret',
        // Long, so only the revalidation request (the thing under test) can refresh the catalog.
        CATALOG_REVALIDATE_SECONDS: '3600',
        REVALIDATE_SECRET: WOO_TEST.revalidateSecret,
        // Checkout switched ON for this server only: it hands carts to the kcpw-core stand-in in the mock store.
        CHECKOUT_ENABLED: 'true',
        // Review submission switched ON for this server only (it talks to the same kcpw-core stand-in); the default server has it off.
        REVIEWS_SUBMIT_ENABLED: 'true',
        // The tests all submit from one address; the real limits (3 per visitor, 60 overall per ten minutes) are proven by unit tests.
        REVIEWS_RATE_LIMIT: '100',
        REVIEWS_RATE_LIMIT_ALL: '1000',
        KCPW_API_URL: WOO_TEST.mockUrl,
        KCPW_HANDOFF_SECRET: WOO_TEST.handoffSecret,
        // The shop's own free-shipping numbers for this server ($25.00, minimum counted before discounts); the default server uses $40.00.
        FREE_SHIPPING_THRESHOLD: '25',
        FREE_SHIPPING_BEFORE_DISCOUNTS: 'true',
      },
    },
  ],
});
