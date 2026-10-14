const PORT = Number(process.env.PORT ?? 3100);

/** Addresses for the end-to-end run that reads a mock WooCommerce store (see mock-woo.mjs). Shared by the config and the spec. */
export const WOO_TEST = {
  mainPort: PORT,
  port: PORT + 1,
  mockPort: PORT + 100,
  url: `http://localhost:${PORT + 1}`,
  mockUrl: `http://127.0.0.1:${PORT + 100}`,
  revalidateSecret: 'e2e-revalidate-secret-not-real',
  // Must equal MOCK_HANDOFF_SECRET in mock-woo.mjs (a unit test checks). A literal here: Playwright loads this file as CommonJS.
  handoffSecret: 'e2e-handoff-secret-not-real-0123456789abcdef',
};
