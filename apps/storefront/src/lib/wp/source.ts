import { KeyedSwrCache, registerContentCache } from '../content-cache';
import type { WpConfig } from './config';
import type { WpClient } from './client';
import { WpError } from './client';
import {
  isShownTerm,
  isUsablePost,
  toPage,
  toPost,
  toPostSummary,
  toTerm,
  utcIso,
} from './convert';
import { WpPostSchema, WpTermSchema, type WpPostRow } from './schema';
import { withTrailingSlash, type SanitizeContext } from './sanitize';
import type { BlogPost, BlogTerm, ContentPage, ContentSource, PostPage, PostQuery } from './types';

const LIST_FIELDS =
  'id,slug,status,date_gmt,modified_gmt,link,title,excerpt,categories,tags,featured_media,_embedded,_links';
const SINGLE_FIELDS = `${LIST_FIELDS},content`;
const INDEX_FIELDS = 'id,slug,status,date_gmt,modified_gmt,link,title';
const PAGE_LINK_FIELDS = 'id,slug,status,link,title';
const INDEX_PER_PAGE = 100;
const INDEX_MAX_PAGES = 10;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9%]+)*$/;

interface IndexEntry {
  slug: string;
  modifiedAt: string;
  path: string;
}

function parseRows(data: unknown): WpPostRow[] {
  if (!Array.isArray(data)) throw new WpError('WordPress returned an unexpected answer');
  const rows: WpPostRow[] = [];
  for (const raw of data) {
    const parsed = WpPostSchema.safeParse(raw);
    if (parsed.success) rows.push(parsed.data);
  }
  return rows;
}

const pathOf = (link: string | undefined): string | null => {
  if (!link) return null;
  try {
    return withTrailingSlash(new URL(link).pathname);
  } catch {
    return null;
  }
};

export interface WpContent extends ContentSource {
  cache: KeyedSwrCache;
}

/**
 * The blog and the WordPress-managed pages, read from the WordPress REST API with GET requests only. Every answer is cached
 * (see lib/content-cache.ts): visitors are served from memory, a stale answer is refreshed once in the background, and when
 * WordPress is down the last good copy keeps being served. A post or page that does not exist is `null`; WordPress being
 * unreachable with nothing cached is an error the page turns into a friendly "try again soon" message.
 */
export function createWpContentSource(deps: {
  config: WpConfig;
  client: WpClient;
  siteOrigin: string;
  /** Registered with the "refresh now" request; tests pass false to keep their caches private. */
  register?: boolean;
  now?: () => number;
}): WpContent {
  const { config, client } = deps;
  const cache = new KeyedSwrCache({ ttlMs: config.ttlSeconds * 1000, maxEntries: 300 }, deps.now);
  if (deps.register !== false) registerContentCache(cache);

  const loadIndex = (): Promise<IndexEntry[]> =>
    cache.get('index', async () => {
      const entries: IndexEntry[] = [];
      for (let page = 1; page <= INDEX_MAX_PAGES; page += 1) {
        const result = await client.get('/posts', {
          per_page: INDEX_PER_PAGE,
          page,
          orderby: 'date',
          order: 'desc',
          has_password: 'false',
          _fields: INDEX_FIELDS,
        });
        for (const row of parseRows(result.data)) {
          if (!isUsablePost(row)) continue;
          entries.push({
            slug: row.slug,
            modifiedAt:
              utcIso(row.modified_gmt) ?? utcIso(row.date_gmt) ?? new Date(0).toISOString(),
            path: pathOf(row.link) ?? '',
          });
        }
        if (page >= result.totalPages) break;
      }
      return entries;
    });

  /** The paths of the managed pages (Our Story, Contact) as WordPress knows them, for link rewriting. */
  const loadPageLinks = (): Promise<Map<string, string>> =>
    cache.get('page-links', async () => {
      const result = await client.get('/pages', {
        slug: `${config.ourStorySlug},${config.contactSlug}`,
        per_page: 10,
        _fields: PAGE_LINK_FIELDS,
      });
      const map = new Map<string, string>();
      for (const row of parseRows(result.data)) {
        const path = pathOf(row.link);
        if (!path) continue;
        if (row.slug === config.ourStorySlug) map.set(path, '/our-story/');
        else if (row.slug === config.contactSlug) map.set(path, '/contact/');
      }
      return map;
    });

  async function context(): Promise<SanitizeContext> {
    // Link rewriting is a nicety: if these lookups fail the links simply stay links to the shop's WordPress.
    const [index, pages] = await Promise.all([
      loadIndex().catch(() => [] as IndexEntry[]),
      loadPageLinks().catch(() => new Map<string, string>()),
    ]);
    const paths = new Map<string, string>(pages);
    for (const entry of index) if (entry.path) paths.set(entry.path, `/blog/${entry.slug}/`);
    return { wpOrigin: config.baseUrl, siteOrigin: deps.siteOrigin, links: { paths } };
  }

  const termList = (kind: 'categories' | 'tags'): Promise<BlogTerm[]> =>
    cache.get(`terms:${kind}`, async () => {
      const terms: BlogTerm[] = [];
      for (let page = 1; page <= 5; page += 1) {
        const result = await client.get(`/${kind}`, {
          per_page: 100,
          page,
          hide_empty: 'true',
          _fields: 'id,name,slug,count,taxonomy',
        });
        if (!Array.isArray(result.data))
          throw new WpError('WordPress returned an unexpected answer');
        for (const raw of result.data) {
          const parsed = WpTermSchema.safeParse(raw);
          if (parsed.success) terms.push(toTerm(parsed.data));
        }
        if (page >= result.totalPages) break;
      }
      return terms.filter(isShownTerm).sort((a, b) => a.name.localeCompare(b.name));
    });

  return {
    cache,

    async listPosts(query: PostQuery): Promise<PostPage> {
      const key = `posts:${query.page}:${query.perPage}:${query.categoryId ?? ''}:${query.tagId ?? ''}`;
      return cache.get(key, async () => {
        const params: Record<string, string | number> = {
          per_page: query.perPage,
          page: query.page,
          orderby: 'date',
          order: 'desc',
          has_password: 'false',
          _embed: 1,
          _fields: LIST_FIELDS,
        };
        if (query.categoryId) params.categories = query.categoryId;
        if (query.tagId) params.tags = query.tagId;
        try {
          const result = await client.get('/posts', params);
          const posts = parseRows(result.data).filter(isUsablePost).map(toPostSummary);
          return { posts, total: result.total, pages: result.totalPages, page: query.page };
        } catch (error) {
          // WordPress answers 400 for a page number beyond the last one.
          if (error instanceof WpError && error.status === 400) {
            return { posts: [], total: 0, pages: 0, page: query.page };
          }
          throw error;
        }
      });
    },

    async getPost(slug: string): Promise<BlogPost | null> {
      if (!SLUG.test(slug) || slug.length > 200) return null;
      // Only slugs WordPress listed are asked for, so a crawler guessing addresses cannot make the shop call WordPress.
      const index = await loadIndex();
      if (!index.some((entry) => entry.slug === slug)) return null;
      return cache.get(`post:${slug}`, async () => {
        const result = await client.get('/posts', {
          slug,
          per_page: 1,
          has_password: 'false',
          _embed: 1,
          _fields: SINGLE_FIELDS,
        });
        const row = parseRows(result.data).find((r) => r.slug === slug && isUsablePost(r));
        return row ? toPost(row, await context()) : null;
      });
    },

    async getPage(slug: string): Promise<ContentPage | null> {
      if (!SLUG.test(slug) || slug.length > 200) return null;
      return cache.get(`page:${slug}`, async () => {
        const result = await client.get('/pages', {
          slug,
          per_page: 1,
          has_password: 'false',
          _embed: 1,
          _fields: SINGLE_FIELDS,
        });
        const row = parseRows(result.data).find(
          (r) =>
            r.slug === slug &&
            (r.status === undefined || r.status === 'publish') &&
            !r.content?.protected,
        );
        return row ? toPage(row, await context()) : null;
      });
    },

    listCategories: () => termList('categories'),
    listTags: () => termList('tags'),

    async listPostIndex() {
      const index = await loadIndex();
      return index.map(({ slug, modifiedAt }) => ({ slug, modifiedAt }));
    },
  };
}
