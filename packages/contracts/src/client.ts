/**
 * The browser-safe entry point: `import ... from '@kcpw/contracts/client'`.
 *
 * Everything reachable from here is free of the validation library (zod), which is ~120 KB of JavaScript
 * the shopper's browser would otherwise download on every page. Types are exported freely (they are erased
 * at build time); runtime code comes only from modules that do not import zod. `test/client-entry.test.ts`
 * walks this entry's import graph and fails if that ever changes.
 *
 * Server code (route handlers, server components, the future WooCommerce adapter) should keep using the
 * full entry, `@kcpw/contracts`, for the schemas.
 */
export * from './money';
export * from './option-logic';
export * from './cart-logic';
export * from './pricing';
export * from './purchase-model';

export type * from './options';
export type * from './cart';
export type * from './handoff';
export type * from './product';
