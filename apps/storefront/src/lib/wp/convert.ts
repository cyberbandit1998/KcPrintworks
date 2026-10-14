import { decodeEntities, plainText, sanitizeContent, type SanitizeContext } from './sanitize';
import { parseMedia, parseTerm, type WpMediaRow, type WpPostRow, type WpTermRow } from './schema';
import type { BlogPost, BlogPostSummary, BlogTerm, ContentImage, ContentPage } from './types';

/** WordPress's catch-all category; it says nothing to a reader, so it is never shown or listed. */
const HIDDEN_TERM_SLUGS = new Set(['uncategorized']);

export function toTerm(row: WpTermRow): BlogTerm {
  return {
    id: row.id,
    name: decodeEntities(row.name).trim() || row.slug,
    slug: row.slug,
    count: row.count ?? 0,
  };
}

export const isShownTerm = (term: Pick<BlogTerm, 'slug'>) => !HIDDEN_TERM_SLUGS.has(term.slug);

/** WordPress sends GMT times without a zone ("2026-09-01T10:00:00"); they are UTC. */
export function utcIso(value: string | null | undefined): string | null {
  if (!value || value.startsWith('0000')) return null;
  const withZone = /(?:Z|[+-]\d\d:?\d\d)$/.test(value) ? value : `${value}Z`;
  const time = Date.parse(withZone);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

function toImage(media: WpMediaRow | undefined, fallbackAlt = ''): ContentImage | undefined {
  // WordPress sends absolute addresses; a root-relative one can only come from the built-in sample content.
  if (!media || !/^(https?:\/\/|\/(?!\/))/i.test(media.source_url)) return undefined;
  const width = media.media_details?.width;
  const height = media.media_details?.height;
  if (!width || !height || width < 1 || height < 1) return undefined;
  return {
    url: media.source_url,
    width,
    height,
    alt: decodeEntities(media.alt_text ?? fallbackAlt).trim(),
  };
}

function embeddedTerms(row: WpPostRow, taxonomy: 'category' | 'post_tag'): BlogTerm[] {
  const groups = row._embedded?.['wp:term'] ?? [];
  const terms: BlogTerm[] = [];
  for (const group of groups) {
    for (const item of group) {
      const parsed = parseTerm(item);
      if (parsed && parsed.taxonomy === taxonomy) terms.push(toTerm(parsed));
    }
  }
  return terms;
}

/** A trimmed excerpt as plain text: WordPress's own "[…]" marker becomes a plain ellipsis. */
export function excerptText(row: Pick<WpPostRow, 'excerpt'>): string {
  const html = row.excerpt?.rendered ?? '';
  return plainText(html)
    .replace(/\s*\[(?:…|\.\.\.|&hellip;)\]\s*$/u, '…')
    .replace(/\s*Continue reading.*$/i, '');
}

/** A post that is not public (protected) or lacks what the pages need is left out rather than shown half-empty. */
export function isUsablePost(row: WpPostRow): boolean {
  if (row.status !== undefined && row.status !== 'publish') return false;
  if (row.content?.protected || row.excerpt?.protected) return false;
  return utcIso(row.date_gmt) !== null && plainText(row.title.rendered) !== '';
}

export function toPostSummary(row: WpPostRow): BlogPostSummary {
  const media = parseMedia(row._embedded?.['wp:featuredmedia']?.[0]);
  const title = plainText(row.title.rendered);
  return {
    id: row.id,
    slug: row.slug,
    title,
    excerpt: excerptText(row),
    publishedAt: utcIso(row.date_gmt) ?? new Date(0).toISOString(),
    modifiedAt: utcIso(row.modified_gmt) ?? utcIso(row.date_gmt) ?? new Date(0).toISOString(),
    image: toImage(media),
    categories: embeddedTerms(row, 'category').filter(isShownTerm),
  };
}

const WORDS_PER_MINUTE = 200;

export function toPost(row: WpPostRow, ctx: SanitizeContext): BlogPost {
  const html = sanitizeContent(row.content?.rendered ?? '', ctx);
  const words = plainText(html).split(' ').filter(Boolean).length;
  return {
    ...toPostSummary(row),
    html,
    tags: embeddedTerms(row, 'post_tag'),
    readingMinutes: Math.max(1, Math.round(words / WORDS_PER_MINUTE)),
  };
}

export function toPage(row: WpPostRow, ctx: SanitizeContext): ContentPage {
  const media = parseMedia(row._embedded?.['wp:featuredmedia']?.[0]);
  return {
    id: row.id,
    slug: row.slug,
    title: plainText(row.title.rendered),
    html: sanitizeContent(row.content?.rendered ?? '', ctx),
    excerpt: excerptText(row),
    modifiedAt: utcIso(row.modified_gmt) ?? utcIso(row.date_gmt) ?? new Date(0).toISOString(),
    image: toImage(media),
  };
}
