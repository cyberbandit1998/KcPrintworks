import { describe, expect, it } from 'vitest';
import { WpError, createWpClient, type WpClient } from '@/lib/wp/client';
import { readWpConfig, type WpConfig } from '@/lib/wp/config';
import { createFixtureWpClient, FIXTURE_WP_CONFIG } from '@/lib/wp/fixture-client';
import { createWpContentSource } from '@/lib/wp/source';
import { KeyedSwrCache } from '@/lib/content-cache';
import { withTimeout } from '@/lib/with-timeout';
import { answerWp, createWpFixture } from '../support/wp-fixture.mjs';

const HOST = 'https://wp.test';
const config: WpConfig = { ...FIXTURE_WP_CONFIG, baseUrl: HOST, ttlSeconds: 60 };

/** A client that answers like WordPress (fields, embeds, 400 beyond the last page) from the synthetic fixture, and counts calls. */
function fakeWp(options: { fixture?: Record<string, unknown> } = {}) {
  const wp = options.fixture ?? createWpFixture(HOST);
  const calls: string[] = [];
  const client: WpClient = {
    async get(path, params = {}) {
      const url = new URL(`/wp-json/wp/v2${path}`, HOST);
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
      calls.push(`${path}?${url.searchParams.toString()}`);
      const answer = answerWp(url, wp);
      if (answer.status >= 400)
        throw new WpError(`WordPress returned HTTP ${answer.status}`, answer.status);
      return {
        data: answer.body,
        total: Number(answer.headers['x-wp-total'] ?? 0),
        totalPages: Number(answer.headers['x-wp-totalpages'] ?? 1),
      };
    },
  };
  return { wp, client, calls };
}

function source(overrides: Partial<Parameters<typeof createWpContentSource>[0]> = {}) {
  const fake = fakeWp();
  let clock = 1_000_000;
  const content = createWpContentSource({
    config,
    client: fake.client,
    siteOrigin: 'https://www.test',
    register: false,
    now: () => clock,
    ...overrides,
  });
  return { ...fake, content, advance: (ms: number) => (clock += ms) };
}

describe('listing posts', () => {
  it('shows only public, published posts with plain-text titles and excerpts, newest first', async () => {
    const { content } = source();
    const page = await content.listPosts({ page: 1, perPage: 9 });
    expect(page.posts.map((p) => p.slug)).toEqual([
      'hostile-content-test',
      'second-post',
      'no-image-post',
    ]); // the protected and draft posts are not listed
    expect(page.posts[0]).toMatchObject({
      title: 'Hostile content – test & check', // entities decoded, never markup
      excerpt: 'Excerpt of hostile-content-test…',
      publishedAt: '2026-10-10T09:30:00.000Z',
    });
  });

  it('uses the featured image and categories WordPress embedded, and hides "Uncategorized"', async () => {
    const { content } = source();
    const [first, , third] = (await content.listPosts({ page: 1, perPage: 9 })).posts;
    expect(first!.image).toEqual({
      url: `${HOST}/images/post.svg`,
      width: 800,
      height: 500,
      alt: 'A synthetic workshop picture',
    });
    expect(first!.categories).toEqual([
      { id: 5, name: 'Updates & News', slug: 'updates', count: 3 },
    ]);
    expect(third!.image).toBeUndefined();
    expect(third!.categories).toEqual([]); // only "Uncategorized"
  });

  it('paginates, and a page beyond the last is empty rather than an error', async () => {
    const { content, wp } = source();
    for (let n = 1; n <= 12; n += 1) {
      (wp.posts as unknown[]).push(
        (wp.post as (...a: unknown[]) => unknown)(
          100 + n,
          `bulk-${n}`,
          `Bulk ${n}`,
          `2026-08-${String(n).padStart(2, '0')}`,
        ),
      );
    }
    const first = await content.listPosts({ page: 1, perPage: 9 });
    expect(first).toMatchObject({ total: 15, pages: 2, page: 1 });
    expect(first.posts).toHaveLength(9);
    expect((await content.listPosts({ page: 2, perPage: 9 })).posts).toHaveLength(6);
    expect(await content.listPosts({ page: 9, perPage: 9 })).toMatchObject({ posts: [], pages: 0 });
  });

  it('filters by category and by tag', async () => {
    const { content } = source();
    expect(
      (await content.listPosts({ page: 1, perPage: 9, categoryId: 5 })).posts.map((p) => p.slug),
    ).toEqual(['hostile-content-test', 'second-post']);
    expect((await content.listPosts({ page: 1, perPage: 9, tagId: 9 })).total).toBe(2);
  });

  it('lists categories and tags that have posts, without "Uncategorized"', async () => {
    const { content } = source();
    expect((await content.listCategories()).map((c) => c.slug)).toEqual(['updates']);
    expect((await content.listTags()).map((t) => t.slug)).toEqual(['printing']);
  });
});

describe('one post', () => {
  it('returns sanitized content with links to other posts pointing at the storefront', async () => {
    const { content } = source();
    const post = await content.getPost('hostile-content-test');
    expect(post).not.toBeNull();
    expect(post!.html).not.toMatch(/<script|onerror|javascript:|<form|evil\.example/i);
    expect(post!.html).toContain('href="/blog/second-post/"'); // the other post's WordPress address -> the storefront's
    expect(post!.html).toContain('href="/product/synthetic-mug/"');
    expect(post!.html).toContain(`href="${HOST}/checkout/"`); // not in the storefront: stays a link to the shop
    expect(post!.tags.map((t) => t.slug)).toEqual(['printing']);
    expect(post!.readingMinutes).toBeGreaterThanOrEqual(1);
  });

  it('is null for a protected post, a draft, and an unknown or malformed slug', async () => {
    const { content } = source();
    for (const slug of ['protected-post', 'draft-post', 'nope', '../etc/passwd', 'A B', '']) {
      expect(await content.getPost(slug), slug).toBeNull();
    }
  });

  it('does not ask WordPress about a slug it never listed', async () => {
    const { content, calls } = source();
    await content.getPost('second-post'); // loads the index, the page links, then the post
    const before = calls.length;
    for (let n = 0; n < 20; n += 1) await content.getPost(`guess-${n}`);
    expect(calls.length).toBe(before);
  });
});

describe('managed pages', () => {
  it('returns a published page, and null when there is none', async () => {
    const { content } = source();
    const page = await content.getPage('our-story');
    expect(page).toMatchObject({ slug: 'our-story', title: 'Our Story' });
    expect(page!.html).toContain('<h2>A heading</h2>');
    expect(await content.getPage('contact')).toBeNull();
  });
});

describe('what is asked of WordPress, and how often', () => {
  it('never sends a credential or anything but GET (the client has no other method)', async () => {
    const seen: RequestInit[] = [];
    const fetchImpl = (async (_url: unknown, init: RequestInit) => {
      seen.push(init);
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    const client = createWpClient({ baseUrl: HOST }, fetchImpl);
    await client.get('/posts', { per_page: 1 });
    expect(seen[0]!.method).toBe('GET');
    expect(seen[0]!.redirect).toBe('error');
    expect(JSON.stringify(seen[0]!.headers)).not.toMatch(/authorization|cookie/i);
  });

  it('answers repeat views from memory', async () => {
    const { content, calls } = source();
    await content.listPosts({ page: 1, perPage: 9 });
    const after = calls.length;
    await content.listPosts({ page: 1, perPage: 9 });
    await content.listPosts({ page: 1, perPage: 9 });
    expect(calls.length).toBe(after);
  });

  it('asks for the lean list (no body) and for the body only on a single post', async () => {
    const { content, calls } = source();
    await content.listPosts({ page: 1, perPage: 9 });
    expect(calls.find((c) => c.startsWith('/posts?') && c.includes('_embed'))).not.toMatch(
      /content/,
    );
    await content.getPost('second-post');
    expect(calls.some((c) => c.includes('slug=second-post') && c.includes('content'))).toBe(true);
  });

  it('refreshes in the background after the interval and serves the old copy meanwhile', async () => {
    const { content, wp, advance } = source();
    expect((await content.listPosts({ page: 1, perPage: 9 })).posts[1]!.title).toBe(
      'The second post',
    );
    (wp.posts as { slug: string; title: { rendered: string } }[]).find(
      (p) => p.slug === 'second-post',
    )!.title.rendered = 'Renamed';
    expect((await content.listPosts({ page: 1, perPage: 9 })).posts[1]!.title).toBe(
      'The second post',
    );
    advance(61_000);
    expect((await content.listPosts({ page: 1, perPage: 9 })).posts[1]!.title).toBe(
      'The second post',
    ); // stale, refreshing
    await new Promise((r) => setTimeout(r, 0));
    expect((await content.listPosts({ page: 1, perPage: 9 })).posts[1]!.title).toBe('Renamed');
  });

  it('shows the last good copy when WordPress goes down, and says unavailable when nothing was ever loaded', async () => {
    const { content, wp, advance } = source();
    await content.listPosts({ page: 1, perPage: 9 });
    wp.failing = true;
    advance(61_000);
    expect((await content.listPosts({ page: 1, perPage: 9 })).posts).toHaveLength(3);
    await new Promise((r) => setTimeout(r, 0));
    expect((await content.listPosts({ page: 1, perPage: 9 })).posts).toHaveLength(3); // still the good copy
    await expect(content.listPosts({ page: 2, perPage: 9 })).rejects.toBeInstanceOf(Error); // never loaded
  });

  it('does not make every visitor wait for the timeout while WordPress is down', async () => {
    const fake = fakeWp();
    fake.wp.failing = true;
    let clock = 5_000_000;
    const content = createWpContentSource({
      config,
      client: fake.client,
      siteOrigin: 'https://www.test',
      register: false,
      now: () => clock,
    });
    await expect(content.listPosts({ page: 1, perPage: 9 })).rejects.toThrow();
    const attempts = fake.calls.length;
    for (let n = 0; n < 10; n += 1)
      await expect(content.listPosts({ page: 1, perPage: 9 })).rejects.toThrow();
    expect(fake.calls.length).toBe(attempts); // answered from the remembered failure
    clock += 16_000;
    fake.wp.failing = false;
    expect((await content.listPosts({ page: 1, perPage: 9 })).posts.length).toBeGreaterThan(0); // recovers
  });
});

describe('the built-in sample content', () => {
  it('runs through the same pipeline and has an Our Story and a Contact page', async () => {
    const content = createWpContentSource({
      config: FIXTURE_WP_CONFIG,
      client: createFixtureWpClient(),
      siteOrigin: 'https://www.test',
      register: false,
    });
    const page = await content.listPosts({ page: 1, perPage: 9 });
    expect(page.total).toBe(11);
    expect(page.pages).toBe(2);
    expect((await content.getPage('our-story'))?.title).toBe('Our Story');
    expect((await content.getPage('contact'))?.title).toBe('Contact');
    const video = await content.getPost('a-sample-post-with-a-video');
    expect(video?.html).toContain('youtube-nocookie.com/embed/');
  });
});

describe('settings', () => {
  it('uses the shop address when WP_BASE_URL is not set, and refuses plain http away from localhost', () => {
    expect(readWpConfig({ WC_BASE_URL: 'https://shop.example.com/' })).toMatchObject({
      ok: true,
      config: { baseUrl: 'https://shop.example.com', ourStorySlug: 'our-story', postsPerPage: 9 },
    });
    expect(
      readWpConfig({
        WP_BASE_URL: 'https://wp.example.com',
        WC_BASE_URL: 'https://shop.example.com',
      }),
    ).toMatchObject({
      config: { baseUrl: 'https://wp.example.com' },
    });
    expect(readWpConfig({ WC_BASE_URL: 'http://shop.example.com' })).toMatchObject({ ok: false });
    expect(readWpConfig({ WC_BASE_URL: 'http://127.0.0.1:3200' })).toMatchObject({ ok: true });
    expect(readWpConfig({})).toMatchObject({ ok: false });
  });

  it('takes page slugs and the page size from the environment, ignoring nonsense', () => {
    const env = { WC_BASE_URL: 'https://shop.example.com' };
    expect(
      readWpConfig({
        ...env,
        OUR_STORY_SLUG: 'about-us',
        CONTACT_PAGE_SLUG: 'Get In Touch',
        BLOG_PER_PAGE: '12',
      }),
    ).toMatchObject({
      config: { ourStorySlug: 'about-us', contactSlug: 'contact', postsPerPage: 12 },
    });
    expect(readWpConfig({ ...env, BLOG_PER_PAGE: '999' })).toMatchObject({
      config: { postsPerPage: 9 },
    });
  });
});

describe('KeyedSwrCache', () => {
  it('forgets the oldest answers beyond its limit, so crawling many pages cannot grow memory', async () => {
    const cache = new KeyedSwrCache({ ttlMs: 1000, maxEntries: 3 });
    for (let n = 0; n < 10; n += 1) await cache.get(`k${n}`, async () => n);
    expect(cache.size()).toBe(3);
  });

  it('a signed refresh makes the very next read load again', async () => {
    let value = 1;
    const cache = new KeyedSwrCache({ ttlMs: 60_000 });
    expect(await cache.get('k', async () => value)).toBe(1);
    value = 2;
    expect(await cache.get('k', async () => value)).toBe(1);
    cache.invalidateAll({ blocking: true });
    expect(await cache.get('k', async () => value)).toBe(2);
  });
});

describe('a remembered failure', () => {
  it('is forgotten by the signed refresh, so the very next view tries again', async () => {
    let clock = 10_000;
    let up = false;
    let calls = 0;
    const cache = new KeyedSwrCache({ ttlMs: 60_000, retryMs: 15_000 }, () => clock);
    const load = async () => {
      calls += 1;
      if (!up) throw new Error('down');
      return 'ok';
    };
    await expect(cache.get('k', load)).rejects.toThrow('down');
    clock += 1_000;
    await expect(cache.get('k', load)).rejects.toThrow('down'); // remembered: no second attempt
    expect(calls).toBe(1);
    up = true;
    clock += 1_000;
    cache.invalidateAll({ blocking: true });
    expect(await cache.get('k', load)).toBe('ok'); // refresh now: tried at once, well inside the 15 s memory
    expect(calls).toBe(2);
  });
});

describe('withTimeout', () => {
  it('gives the fallback when the work is too slow or fails, and the value when it is quick', async () => {
    expect(
      await withTimeout(new Promise((r) => setTimeout(() => r('slow'), 200)), 10, 'fallback'),
    ).toBe('fallback');
    expect(await withTimeout(Promise.reject(new Error('x')), 10, 'fallback')).toBe('fallback');
    expect(await withTimeout(Promise.resolve('quick'), 10, 'fallback')).toBe('quick');
  });
});
