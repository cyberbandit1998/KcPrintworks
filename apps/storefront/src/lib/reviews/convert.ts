import sanitizeHtml from 'sanitize-html';
import { decodeEntities } from '../wp/sanitize';
import { utcIso } from '../wp/convert';
import type { StoreReview } from './schema';
import type { Review } from './types';

/**
 * The name shown with a review: first name and the initial of the last ("Jane D."). A name that looks like an email address, or is
 * empty, is shown as "Customer", so a login name or address that WordPress used as a display name is never published.
 */
export function shortAuthor(raw: string | null | undefined): string {
  const text = decodeEntities(sanitizeHtml(raw ?? '', { allowedTags: [], allowedAttributes: {} }))
    .replace(/\s+/g, ' ')
    .trim();
  if (text === '' || text.includes('@')) return 'Customer';
  const parts = text.split(' ');
  const first = Array.from(parts[0]!).slice(0, 24).join('');
  const last = parts.length > 1 ? Array.from(parts[parts.length - 1]!)[0] : undefined;
  return last && /\p{L}/u.test(last) ? `${first} ${last.toUpperCase()}.` : first;
}

/** Review text as paragraphs of plain text. Line breaks and paragraph ends are kept; every tag is removed before entities are decoded. */
export function reviewParagraphs(html: string | null | undefined): string[] {
  const withBreaks = (html ?? '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p\s*>/gi, '\n\n');
  const text = decodeEntities(sanitizeHtml(withBreaks, { allowedTags: [], allowedAttributes: {} }));
  return text
    .split(/\n{1,}/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 12);
}

/** A review with a whole rating from 1 to 5 and some text, or null (a reply, an empty or malformed row is not shown). */
export function toReview(row: StoreReview): Review | null {
  const rating = row.rating;
  if (typeof rating !== 'number' || !Number.isInteger(rating) || rating < 1 || rating > 5)
    return null;
  const paragraphs = reviewParagraphs(row.review);
  if (paragraphs.length === 0) return null;
  const publishedAt = utcIso(row.date_created_gmt) ?? utcIso(row.date_created);
  if (!publishedAt) return null;
  return {
    id: row.id,
    productId: row.product_id,
    productName: decodeEntities(row.product_name ?? '').trim(),
    author: shortAuthor(row.reviewer),
    rating,
    paragraphs,
    publishedAt,
    verified: row.verified === true,
  };
}
