import { catalogSourceName, siteUrl } from '../env';
import { createWpClient, WpError } from './client';
import { readWpConfig, type WpConfig } from './config';
import { createFixtureWpClient, FIXTURE_WP_CONFIG } from './fixture-client';
import { createWpContentSource, type WpContent } from './source';

export type { ContentSource } from './types';

/**
 * One content source per server process (pages and API routes are bundled separately, so it lives on globalThis, like the
 * catalog service). With CATALOG_SOURCE=woo the content is read from the shop's WordPress; otherwise the built-in sample
 * content is used, so the design preview and tests need no WordPress.
 */
const GLOBAL_KEY = Symbol.for('kcpw.wpContentSource');
type Holder = typeof globalThis & { [GLOBAL_KEY]?: { source: WpContent; config: WpConfig | null } };

const siteOrigin = () => {
  try {
    return new URL(siteUrl).origin;
  } catch {
    return 'http://localhost:3000';
  }
};

function notConfigured(missing: string[]): WpContent {
  const fail = () =>
    Promise.reject(new WpError(`WordPress is not configured (${missing.join(', ')})`));
  return {
    cache: undefined as never,
    listPosts: fail,
    getPost: fail,
    getPage: fail,
    listCategories: fail,
    listTags: fail,
    listPostIndex: fail,
  };
}

export function getContentService(): { source: WpContent; config: WpConfig | null } {
  const holder = globalThis as Holder;
  if (holder[GLOBAL_KEY]) return holder[GLOBAL_KEY];
  let created: { source: WpContent; config: WpConfig | null };
  if (catalogSourceName === 'woo') {
    const read = readWpConfig();
    created = read.ok
      ? {
          config: read.config,
          source: createWpContentSource({
            config: read.config,
            client: createWpClient(read.config),
            siteOrigin: siteOrigin(),
          }),
        }
      : { config: null, source: notConfigured(read.missing) };
  } else {
    created = {
      config: FIXTURE_WP_CONFIG,
      source: createWpContentSource({
        config: FIXTURE_WP_CONFIG,
        client: createFixtureWpClient(),
        siteOrigin: siteOrigin(),
      }),
    };
  }
  holder[GLOBAL_KEY] = created;
  return created;
}

export function getContent(): WpContent {
  return getContentService().source;
}

/** Settings the pages need (managed page slugs, posts per page). Falls back to the defaults when WordPress is not configured. */
export function getContentConfig(): WpConfig {
  return getContentService().config ?? FIXTURE_WP_CONFIG;
}

/** For /api/catalog-status/: whether WordPress content is set up and how its cached answers are doing. No address, no error body. */
export function contentStatus() {
  const { source, config } = getContentService();
  const cache = source.cache as WpContent['cache'] | undefined;
  return {
    configured: config !== null,
    ...(cache ? cache.status() : { entries: 0, failing: 0, lastError: null }),
  };
}
