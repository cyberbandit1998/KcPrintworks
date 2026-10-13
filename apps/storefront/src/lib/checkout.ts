/**
 * Checkout is connected in Step 3 (secure single-use cart handoff to the WooCommerce-hosted checkout on the
 * shop host, using the official Stripe plugin in test mode). Until then the cart page shows a disabled
 * button with an explanation, so nothing can be mistaken for a working purchase flow.
 */
export const checkoutAvailable = false;
