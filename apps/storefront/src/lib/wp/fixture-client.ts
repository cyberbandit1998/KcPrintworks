import { WpError, type WpClient, type WpResult } from './client';
import type { WpConfig } from './config';

/**
 * SYNTHETIC blog and page content for the design preview (CATALOG_SOURCE=fixtures, the default) and for tests. It answers the
 * same requests the WordPress client sends and returns rows shaped like wp/v2 responses, so the preview runs the real
 * conversion, sanitizer and caching code. None of the text is the owner's: it says so, and invents nothing about the business.
 */
export const FIXTURE_WP_CONFIG: WpConfig = {
  baseUrl: 'https://wordpress.example',
  ttlSeconds: 120,
  ourStorySlug: 'our-story',
  contactSlug: 'contact',
  postsPerPage: 9,
};

type Row = Record<string, unknown>;

const categories = [
  { id: 1, name: 'Uncategorized', slug: 'uncategorized', taxonomy: 'category', count: 1 },
  { id: 11, name: 'Behind the Scenes', slug: 'behind-the-scenes', taxonomy: 'category', count: 6 },
  { id: 12, name: 'Gift Ideas', slug: 'gift-ideas', taxonomy: 'category', count: 5 },
];
const tags = [
  { id: 21, name: '3D Printing', slug: '3d-printing', taxonomy: 'post_tag', count: 4 },
  { id: 22, name: 'Personalization', slug: 'personalization', taxonomy: 'post_tag', count: 3 },
];

const media = (file: string, alt: string) => [
  {
    id: 900,
    source_url: `/fixtures/${file}`,
    alt_text: alt,
    media_type: 'image',
    media_details: { width: 800, height: 800 },
  },
];

function post(
  id: number,
  title: string,
  date: string,
  options: {
    cats?: number[];
    tagIds?: number[];
    image?: string;
    content: string;
    excerpt?: string;
  },
): Row {
  const cats = options.cats ?? [11];
  const tagIds = options.tagIds ?? [];
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return {
    id,
    slug,
    status: 'publish',
    type: 'post',
    date_gmt: `${date}T14:00:00`,
    modified_gmt: `${date}T14:00:00`,
    link: `${FIXTURE_WP_CONFIG.baseUrl}/${slug}/`,
    title: { rendered: title },
    excerpt: {
      rendered: `<p>${options.excerpt ?? `Sample post for design review. ${title}.`} [&hellip;]</p>`,
    },
    content: { rendered: options.content, protected: false },
    categories: cats,
    tags: tagIds,
    featured_media: options.image ? 900 : 0,
    _embedded: {
      ...(options.image ? { 'wp:featuredmedia': media(options.image, '') } : {}),
      'wp:term': [
        categories.filter((c) => cats.includes(c.id)),
        tags.filter((t) => tagIds.includes(t.id)),
      ],
    },
  };
}

const SAMPLE_NOTE =
  '<p>This is sample text for the design preview. Your own posts, written in WordPress, replace it.</p>';

const handwritten: Row[] = [
  post(110, 'A sample post with headings and a list', '2026-10-09', {
    cats: [11],
    tagIds: [21],
    image: 'print-a.svg',
    excerpt: 'Sample text that shows how a post with headings and a list looks.',
    content: `${SAMPLE_NOTE}<h2>A heading inside a post</h2><p>Paragraphs, <strong>bold</strong> and <em>italic</em> text, and <a href="/shop/">a link to the shop</a> look like this.</p><h3>A smaller heading</h3><ul><li>The first point</li><li>The second point</li></ul><blockquote><p>A quotation is set apart like this.</p></blockquote>`,
  }),
  post(109, 'A sample post with a video', '2026-10-02', {
    cats: [12],
    tagIds: [22],
    image: 'mug.svg',
    excerpt: 'Sample text that shows how an embedded video looks.',
    content: `${SAMPLE_NOTE}<figure class="wp-block-embed is-type-video wp-embed-aspect-16-9 wp-has-aspect-ratio"><div class="wp-block-embed__wrapper"><iframe title="Sample video" width="640" height="360" src="https://www.youtube.com/embed/aqz-KE-bpKQ?feature=oembed" allowfullscreen></iframe></div></figure><p>Videos load only from YouTube (privacy-enhanced) and Vimeo.</p>`,
  }),
  post(108, 'A short sample post', '2026-09-25', {
    cats: [12],
    tagIds: [21, 22],
    image: 'tote.svg',
    content: SAMPLE_NOTE,
  }),
];

const generated: Row[] = Array.from({ length: 8 }, (_, index) => {
  const n = index + 1;
  return post(100 + n, `Sample post number ${n}`, `2026-09-${String(20 - n).padStart(2, '0')}`, {
    cats: n % 2 === 0 ? [12] : [11],
    tagIds: n % 3 === 0 ? [21] : [],
    image: n % 2 === 0 ? 'stickers.svg' : undefined,
    content: SAMPLE_NOTE,
  });
});

const posts: Row[] = [...handwritten, ...generated];

const pages: Row[] = [
  {
    id: 301,
    slug: 'our-story',
    status: 'publish',
    type: 'page',
    date_gmt: '2026-09-01T10:00:00',
    modified_gmt: '2026-09-01T10:00:00',
    link: `${FIXTURE_WP_CONFIG.baseUrl}/our-story/`,
    title: { rendered: 'Our Story' },
    excerpt: { rendered: '<p>Sample text for the design preview.</p>' },
    content: {
      rendered: `<p>This is sample text for the design preview. The real Our Story is written by the owner on a WordPress page (its address ends in <code>our-story</code>) and appears here.</p><h2>A heading</h2><p>Headings, paragraphs, lists and pictures from that page are shown in this space.</p>`,
      protected: false,
    },
  },
  {
    id: 302,
    slug: 'contact',
    status: 'publish',
    type: 'page',
    date_gmt: '2026-09-01T10:00:00',
    modified_gmt: '2026-09-01T10:00:00',
    link: `${FIXTURE_WP_CONFIG.baseUrl}/contact/`,
    title: { rendered: 'Contact' },
    excerpt: { rendered: '<p>Sample text for the design preview.</p>' },
    content: {
      rendered:
        '<p>This is sample text for the design preview. The real contact details are written by the owner on a WordPress page (its address ends in <code>contact</code>) and appear here.</p>',
      protected: false,
    },
  },
];

const wanted = (value: string | number | undefined): string[] =>
  String(value ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

export function createFixtureWpClient(): WpClient {
  async function get(
    path: string,
    params: Record<string, string | number> = {},
  ): Promise<WpResult> {
    const perPage = Math.min(100, Number(params.per_page ?? 10));
    const page = Number(params.page ?? 1);
    let rows: Row[];
    if (path === '/posts') {
      rows = [...posts].sort((a, b) => String(b.date_gmt).localeCompare(String(a.date_gmt)));
      const cat = wanted(params.categories);
      const tag = wanted(params.tags);
      if (cat.length)
        rows = rows.filter((r) => (r.categories as number[]).some((c) => cat.includes(String(c))));
      if (tag.length)
        rows = rows.filter((r) => (r.tags as number[]).some((t) => tag.includes(String(t))));
    } else if (path === '/pages') {
      rows = [...pages];
    } else if (path === '/categories' || path === '/tags') {
      rows = path === '/categories' ? categories : tags;
    } else {
      return { data: { code: 'rest_no_route' }, total: 0, totalPages: 1 };
    }
    const slugs = wanted(params.slug);
    if (slugs.length) rows = rows.filter((r) => slugs.includes(String(r.slug)));
    const totalPages = Math.max(1, Math.ceil(rows.length / perPage));
    if (page > totalPages && rows.length > 0) {
      throw new WpError('rest_post_invalid_page_number', 400);
    }
    return {
      data: rows.slice((page - 1) * perPage, page * perPage),
      total: rows.length,
      totalPages,
    };
  }
  return { get };
}
