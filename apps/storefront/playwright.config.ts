import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

/**
 * The sandbox ships a Chromium build that may not match this Playwright version's expected revision, so an
 * explicit executable is used when present. In CI, `npx playwright install chromium` provides the browser.
 */
const localChromium = process.env.PW_CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';
const executablePath = existsSync(localChromium) ? localChromium : undefined;

const PORT = Number(process.env.PORT ?? 3100);

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
  webServer: {
    command: `npm run build && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    env: { SITE_ENV: 'development' },
  },
});
