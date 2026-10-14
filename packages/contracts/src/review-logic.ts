/**
 * Reference validation for a customer review submitted from the storefront. Zod-free on purpose: the browser runs it for instant feedback,
 * the storefront server runs it before anything is sent on, and kcpw-core (PHP) must reach the SAME verdict (shared vectors in
 * test/vectors/reviews.json are generated from this file; change it deliberately with UPDATE_VECTORS=1 and update the PHP side too).
 *
 * What a submission CAN say: which product, a rating, a display name, an email address, and the text. It can never say whether the
 * review is approved, verified, or from which address it came: those are decided by WooCommerce and WordPress, and any such field is
 * refused as unknown. Invisible and control characters are refused, as are links in the text (spam), and a name may only hold letters,
 * numbers, spaces, and . ' - so it can never carry an address or a link.
 */

export const REVIEW_LIMITS = {
  nameMin: 2,
  nameMax: 60,
  emailMax: 120,
  textMin: 10,
  textMax: 2000,
} as const;

export type ReviewIssueCode =
  | 'invalid_type'
  | 'unknown_field'
  | 'required'
  | 'too_short'
  | 'too_long'
  | 'invalid_characters'
  | 'invalid_email'
  | 'invalid_rating'
  | 'invalid_product'
  | 'links_not_allowed';

export interface ReviewIssue {
  /** The field's name, or '' when the whole submission is the problem. */
  field: string;
  code: ReviewIssueCode;
  message: string;
}

export interface ReviewInput {
  productId: number;
  rating: number;
  name: string;
  email: string;
  review: string;
}

export type ReviewValidation =
  { ok: true; value: ReviewInput } | { ok: false; issues: ReviewIssue[] };

const FIELDS = ['productId', 'rating', 'name', 'email', 'review'] as const;

// Same ranges as option-logic.ts: ASCII controls, C1 controls, zero-width, bidi, byte-order mark. Newline is allowed in the text only.
const FORBIDDEN_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x0000, 0x0009],
  [0x000b, 0x001f],
  [0x007f, 0x009f],
  [0x200b, 0x200f],
  [0x202a, 0x202e],
  [0x2066, 0x2069],
  [0xfeff, 0xfeff],
];

const count = (text: string) => Array.from(text).length;

function hasForbidden(text: string, allowNewline: boolean): boolean {
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code === 0x0a) {
      if (!allowNewline) return true;
      continue;
    }
    if (FORBIDDEN_RANGES.some(([low, high]) => code >= low && code <= high)) return true;
  }
  return false;
}

/** The characters JavaScript's trim() removes, spelled out so PHP can use exactly the same set. */
const SPACE_RUN = /[\t-\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+/g;

/** NFC, line endings to "\n", trimmed like JavaScript. */
const normalize = (raw: string) => raw.normalize('NFC').replace(/\r\n?/g, '\n').trim();

const NAME_CHARACTERS = /^[\p{L}\p{M}\p{N} .'’-]+$/u;
const HAS_LETTER = /\p{L}/u;
const EMAIL =
  /^[a-z0-9](?:[a-z0-9._%+-]{0,62}[a-z0-9])?@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;
const LINK =
  /https?:\/\/|\bwww\.|\b[a-z0-9-]+\.(?:com|net|org|io|co|ru|xyz|top|shop|site|info|biz|click|link)\b/i;

export function validateReviewInput(input: unknown): ReviewValidation {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return {
      ok: false,
      issues: [
        { field: '', code: 'invalid_type', message: 'The review is not in the expected form.' },
      ],
    };
  }
  const data = input as Record<string, unknown>;
  const issues: ReviewIssue[] = [];
  const known = new Set<string>(FIELDS);
  for (const key of Object.keys(data)) {
    if (!known.has(key)) {
      issues.push({ field: key, code: 'unknown_field', message: `Unknown field "${key}".` });
    }
  }
  const issue = (field: string, code: ReviewIssueCode, message: string) =>
    issues.push({ field, code, message });
  const missing = (value: unknown) => value === undefined || value === null || value === '';

  // productId
  const productId = data.productId;
  if (missing(productId)) issue('productId', 'required', 'The product is missing.');
  else if (
    typeof productId !== 'number' ||
    !Number.isInteger(productId) ||
    productId < 1 ||
    productId > 2147483647
  )
    issue('productId', 'invalid_product', 'This product cannot be reviewed.');

  // rating
  const rating = data.rating;
  if (missing(rating)) issue('rating', 'required', 'Choose a rating from 1 to 5 stars.');
  else if (typeof rating !== 'number' || !Number.isInteger(rating) || rating < 1 || rating > 5)
    issue('rating', 'invalid_rating', 'Choose a rating from 1 to 5 stars.');

  // name
  let name = '';
  if (missing(data.name)) issue('name', 'required', 'Enter your name.');
  else if (typeof data.name !== 'string') issue('name', 'invalid_type', 'Enter your name.');
  else {
    name = normalize(data.name).replace(SPACE_RUN, ' ');
    if (name === '') issue('name', 'required', 'Enter your name.');
    else if (hasForbidden(name, false) || !NAME_CHARACTERS.test(name) || !HAS_LETTER.test(name))
      issue(
        'name',
        'invalid_characters',
        "Use only letters, numbers, spaces, and . ' - in your name.",
      );
    else if (count(name) < REVIEW_LIMITS.nameMin)
      issue('name', 'too_short', `Your name must be at least ${REVIEW_LIMITS.nameMin} characters.`);
    else if (count(name) > REVIEW_LIMITS.nameMax)
      issue('name', 'too_long', `Your name must be at most ${REVIEW_LIMITS.nameMax} characters.`);
  }

  // email (ASCII only; lower-cased the same way everywhere)
  let email = '';
  if (missing(data.email)) issue('email', 'required', 'Enter your email address.');
  else if (typeof data.email !== 'string')
    issue('email', 'invalid_type', 'Enter your email address.');
  else {
    email = normalize(data.email).replace(/[A-Z]/g, (c) => c.toLowerCase());
    if (email === '') issue('email', 'required', 'Enter your email address.');
    else if (count(email) > REVIEW_LIMITS.emailMax)
      issue(
        'email',
        'too_long',
        `Your email address must be at most ${REVIEW_LIMITS.emailMax} characters.`,
      );
    else if (!EMAIL.test(email) || email.includes('..'))
      issue('email', 'invalid_email', 'Enter a valid email address, like name@example.com.');
  }

  // review text
  let review = '';
  if (missing(data.review)) issue('review', 'required', 'Write your review.');
  else if (typeof data.review !== 'string') issue('review', 'invalid_type', 'Write your review.');
  else {
    review = normalize(data.review).replace(/\n{3,}/g, '\n\n');
    if (review === '') issue('review', 'required', 'Write your review.');
    else if (hasForbidden(review, true))
      issue(
        'review',
        'invalid_characters',
        'Your review contains characters that cannot be saved.',
      );
    else if (count(review) < REVIEW_LIMITS.textMin)
      issue(
        'review',
        'too_short',
        `Your review must be at least ${REVIEW_LIMITS.textMin} characters.`,
      );
    else if (count(review) > REVIEW_LIMITS.textMax)
      issue(
        'review',
        'too_long',
        `Your review must be at most ${REVIEW_LIMITS.textMax} characters.`,
      );
    else if (LINK.test(review))
      issue(
        'review',
        'links_not_allowed',
        'Please leave web addresses and email addresses out of your review.',
      );
  }

  if (issues.length > 0) return { ok: false, issues };
  return {
    ok: true,
    value: { productId: productId as number, rating: rating as number, name, email, review },
  };
}
