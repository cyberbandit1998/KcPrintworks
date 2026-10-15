/**
 * Reference validation for a custom quote request and for the customer's approval of a quote. Zod-free on purpose: the browser runs it
 * for instant feedback, the storefront server runs it before anything is sent on, and the kcpw-quotes plugin (PHP) must reach the SAME
 * verdict (the shared vectors in test/vectors/quotes.json are generated from this file; change it deliberately with UPDATE_VECTORS=1
 * and update the PHP side in the same change).
 *
 * What a request CAN say: who is asking, what they want made and how many, and when they would like it. It can never say what it will
 * cost, what status it has, or which order it belongs to: any such field is refused as unknown. The price of a quote is only ever set by
 * the shop owner in WordPress (CLAUDE.md: the browser never supplies prices). Invisible and control characters are refused, and web
 * addresses are kept out of every short field and limited to two in the description (people do share a model link).
 */

export const QUOTE_LIMITS = {
  nameMin: 2,
  nameMax: 80,
  emailMax: 120,
  gameMax: 120,
  descriptionMin: 20,
  descriptionMax: 4000,
  dimensionsMax: 200,
  colorsMax: 200,
  shipToMax: 120,
  quantityMin: 1,
  quantityMax: 1000,
  linksInDescriptionMax: 2,
  addressLineMin: 3,
  addressLineMax: 100,
  cityMin: 2,
  cityMax: 60,
  stateMax: 60,
  postcodeMin: 3,
  postcodeMax: 12,
  phoneMax: 30,
} as const;

/** The kinds of project the form offers: the value sent, and the words shown. */
export const PROJECT_TYPES = [
  { value: 'game-case', label: 'Game case or box' },
  { value: 'organizer-insert', label: 'Organizer or insert' },
  { value: 'personalized-gift', label: 'Personalized gift' },
  { value: 'replacement-part', label: 'Replacement or repair part' },
  { value: 'display-sign', label: 'Display or sign' },
  { value: 'prototype', label: 'Prototype or one-off' },
  { value: 'other', label: 'Something else' },
] as const;
export type ProjectType = (typeof PROJECT_TYPES)[number]['value'];

export type CustomQuoteIssueCode =
  | 'invalid_type'
  | 'unknown_field'
  | 'required'
  | 'too_short'
  | 'too_long'
  | 'invalid_characters'
  | 'invalid_email'
  | 'invalid_choice'
  | 'invalid_quantity'
  | 'invalid_date'
  | 'links_not_allowed'
  | 'too_many_links'
  | 'terms_required';

export interface CustomQuoteIssue {
  /** The field's name, or '' when the whole submission is the problem. */
  field: string;
  code: CustomQuoteIssueCode;
  message: string;
}

export interface CustomQuoteRequestInput {
  name: string;
  email: string;
  projectType: ProjectType;
  /** The game or theme, when there is one ("" when left empty). */
  game: string;
  description: string;
  dimensions: string;
  quantity: number;
  colors: string;
  /** YYYY-MM-DD, or "" for no deadline. */
  deadline: string;
  /** Where it would ship (a country and ZIP or postcode is enough), to help quote shipping; "" when left empty. */
  shipTo: string;
}

export type CustomQuoteRequestValidation =
  { ok: true; value: CustomQuoteRequestInput } | { ok: false; issues: CustomQuoteIssue[] };

const REQUEST_FIELDS = [
  'name',
  'email',
  'projectType',
  'game',
  'description',
  'dimensions',
  'quantity',
  'colors',
  'deadline',
  'shipTo',
] as const;

// Same ranges as review-logic.ts and option-logic.ts: ASCII controls, C1 controls, zero-width, bidi, byte-order mark.
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
const normalize = (raw: string) => raw.normalize('NFC').replace(/\r\n?/g, '\n').trim();

const NAME_CHARACTERS = /^[\p{L}\p{M}\p{N} .'’-]+$/u;
const HAS_LETTER = /\p{L}/u;
const EMAIL =
  /^[a-z0-9](?:[a-z0-9._%+-]{0,62}[a-z0-9])?@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;
const LINK =
  /https?:\/\/|\bwww\.|\b[a-z0-9-]+\.(?:com|net|org|io|co|ru|xyz|top|shop|site|info|biz|click|link)\b/gi;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Is `text` a real calendar date written YYYY-MM-DD? (2026-02-30 is not.) */
export function isCalendarDate(text: string): boolean {
  const match = DATE.exec(text);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1) return false;
  const last = [
    31,
    year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ][month - 1]!;
  return day <= last;
}

/**
 * A deadline must not be in the past and not more than two years away. Separate from the vectors because it depends on today's date.
 * `todayIso` is today's date as YYYY-MM-DD in the shop's time zone.
 */
export function deadlineProblem(deadline: string, todayIso: string): 'past' | 'too_far' | null {
  if (deadline === '') return null;
  if (deadline < todayIso) return 'past';
  const [y, m, d] = todayIso.split('-').map(Number) as [number, number, number];
  const limit = `${String(y + 2).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return deadline > limit ? 'too_far' : null;
}

function singleLine(
  data: Record<string, unknown>,
  field: (typeof REQUEST_FIELDS)[number],
  max: number,
  label: string,
  issue: (f: string, c: CustomQuoteIssueCode, m: string) => void,
): string {
  const raw = data[field];
  if (raw === undefined || raw === null || raw === '') return '';
  if (typeof raw !== 'string') {
    issue(field, 'invalid_type', `${label} is not valid.`);
    return '';
  }
  const text = normalize(raw).replace(SPACE_RUN, ' ');
  if (text === '') return '';
  if (hasForbidden(text, false)) {
    issue(field, 'invalid_characters', `${label} contains characters that cannot be saved.`);
    return '';
  }
  if (count(text) > max) {
    issue(field, 'too_long', `${label} must be at most ${max} characters.`);
    return '';
  }
  if ((text.match(LINK) ?? []).length > 0) {
    issue(field, 'links_not_allowed', `Please leave web addresses out of ${label.toLowerCase()}.`);
    return '';
  }
  return text;
}

export function validateQuoteRequest(input: unknown): CustomQuoteRequestValidation {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return {
      ok: false,
      issues: [
        { field: '', code: 'invalid_type', message: 'The request is not in the expected form.' },
      ],
    };
  }
  const data = input as Record<string, unknown>;
  const issues: CustomQuoteIssue[] = [];
  const known = new Set<string>(REQUEST_FIELDS);
  for (const key of Object.keys(data)) {
    if (!known.has(key))
      issues.push({ field: key, code: 'unknown_field', message: `Unknown field "${key}".` });
  }
  const issue = (field: string, code: CustomQuoteIssueCode, message: string) =>
    issues.push({ field, code, message });
  const missing = (value: unknown) => value === undefined || value === null || value === '';

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
    else if (count(name) < QUOTE_LIMITS.nameMin)
      issue('name', 'too_short', `Your name must be at least ${QUOTE_LIMITS.nameMin} characters.`);
    else if (count(name) > QUOTE_LIMITS.nameMax)
      issue('name', 'too_long', `Your name must be at most ${QUOTE_LIMITS.nameMax} characters.`);
  }

  // email (ASCII only; lower-cased the same way everywhere)
  let email = '';
  if (missing(data.email)) issue('email', 'required', 'Enter your email address.');
  else if (typeof data.email !== 'string')
    issue('email', 'invalid_type', 'Enter your email address.');
  else {
    email = normalize(data.email).replace(/[A-Z]/g, (c) => c.toLowerCase());
    if (email === '') issue('email', 'required', 'Enter your email address.');
    else if (count(email) > QUOTE_LIMITS.emailMax)
      issue(
        'email',
        'too_long',
        `Your email address must be at most ${QUOTE_LIMITS.emailMax} characters.`,
      );
    else if (!EMAIL.test(email) || email.includes('..'))
      issue('email', 'invalid_email', 'Enter a valid email address, like name@example.com.');
  }

  // project type
  let projectType = '';
  if (missing(data.projectType)) issue('projectType', 'required', 'Choose the kind of project.');
  else if (
    typeof data.projectType !== 'string' ||
    !PROJECT_TYPES.some((t) => t.value === data.projectType)
  )
    issue('projectType', 'invalid_choice', 'Choose the kind of project from the list.');
  else projectType = data.projectType;

  // game / theme, dimensions, colors, shipTo: optional short text
  const game = singleLine(data, 'game', QUOTE_LIMITS.gameMax, 'The game or theme', issue);
  const dimensions = singleLine(
    data,
    'dimensions',
    QUOTE_LIMITS.dimensionsMax,
    'The dimensions',
    issue,
  );
  const colors = singleLine(data, 'colors', QUOTE_LIMITS.colorsMax, 'The colors', issue);
  const shipTo = singleLine(data, 'shipTo', QUOTE_LIMITS.shipToMax, 'Where it ships', issue);

  // description
  let description = '';
  if (missing(data.description))
    issue('description', 'required', 'Tell us what you would like made.');
  else if (typeof data.description !== 'string')
    issue('description', 'invalid_type', 'Tell us what you would like made.');
  else {
    description = normalize(data.description).replace(/\n{3,}/g, '\n\n');
    if (description === '') issue('description', 'required', 'Tell us what you would like made.');
    else if (hasForbidden(description, true))
      issue(
        'description',
        'invalid_characters',
        'Your description contains characters that cannot be saved.',
      );
    else if (count(description) < QUOTE_LIMITS.descriptionMin)
      issue(
        'description',
        'too_short',
        `Please write at least ${QUOTE_LIMITS.descriptionMin} characters so we can quote it.`,
      );
    else if (count(description) > QUOTE_LIMITS.descriptionMax)
      issue(
        'description',
        'too_long',
        `Your description must be at most ${QUOTE_LIMITS.descriptionMax} characters.`,
      );
    else if ((description.match(LINK) ?? []).length > QUOTE_LIMITS.linksInDescriptionMax)
      issue(
        'description',
        'too_many_links',
        `Please include at most ${QUOTE_LIMITS.linksInDescriptionMax} web addresses.`,
      );
  }

  // quantity (a whole number, sent as a number)
  const quantity = data.quantity;
  if (missing(quantity)) issue('quantity', 'required', 'Enter how many you need.');
  else if (
    typeof quantity !== 'number' ||
    !Number.isInteger(quantity) ||
    quantity < QUOTE_LIMITS.quantityMin ||
    quantity > QUOTE_LIMITS.quantityMax
  )
    issue(
      'quantity',
      'invalid_quantity',
      `Enter a whole number from ${QUOTE_LIMITS.quantityMin} to ${QUOTE_LIMITS.quantityMax}.`,
    );

  // deadline (optional; a real calendar date)
  let deadline = '';
  if (!missing(data.deadline)) {
    if (typeof data.deadline !== 'string') issue('deadline', 'invalid_type', 'Choose a date.');
    else {
      deadline = data.deadline.trim();
      if (!isCalendarDate(deadline)) {
        issue('deadline', 'invalid_date', 'Enter a real date, like 2026-12-24.');
        deadline = '';
      }
    }
  }

  if (issues.length > 0) return { ok: false, issues };
  return {
    ok: true,
    value: {
      name,
      email,
      projectType: projectType as ProjectType,
      game,
      description,
      dimensions,
      quantity: quantity as number,
      colors,
      deadline,
      shipTo,
    },
  };
}

// ----------------------------------------------------------------------------------------------------- approval

export interface CustomQuoteApprovalInput {
  /** The revision of the quote the customer is looking at: an approval of an older revision is refused. */
  revision: number;
  line1: string;
  line2: string;
  city: string;
  state: string;
  postcode: string;
  /** ISO 3166-1 alpha-2, upper case. */
  country: string;
  phone: string;
  accepted: true;
}

export type CustomQuoteApprovalValidation =
  { ok: true; value: CustomQuoteApprovalInput } | { ok: false; issues: CustomQuoteIssue[] };

const APPROVAL_FIELDS = [
  'revision',
  'line1',
  'line2',
  'city',
  'state',
  'postcode',
  'country',
  'phone',
  'accepted',
] as const;
const POSTCODE = /^[A-Za-z0-9][A-Za-z0-9 -]{1,10}[A-Za-z0-9]$/;
const PHONE = /^[0-9+()\-. ]{5,30}$/;

/** The shipping address and the customer's "yes". There is no price and no quote number in it: the server looks those up. */
export function validateQuoteApproval(input: unknown): CustomQuoteApprovalValidation {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return {
      ok: false,
      issues: [
        { field: '', code: 'invalid_type', message: 'The approval is not in the expected form.' },
      ],
    };
  }
  const data = input as Record<string, unknown>;
  const issues: CustomQuoteIssue[] = [];
  const known = new Set<string>(APPROVAL_FIELDS);
  for (const key of Object.keys(data)) {
    if (!known.has(key))
      issues.push({ field: key, code: 'unknown_field', message: `Unknown field "${key}".` });
  }
  const issue = (field: string, code: CustomQuoteIssueCode, message: string) =>
    issues.push({ field, code, message });
  const missing = (value: unknown) => value === undefined || value === null || value === '';

  const revision = data.revision;
  if (
    typeof revision !== 'number' ||
    !Number.isInteger(revision) ||
    revision < 0 ||
    revision > 100000
  )
    issue('revision', 'invalid_type', 'This page is out of date. Please reload it.');

  const text = (
    field: string,
    label: string,
    min: number,
    max: number,
    required: boolean,
  ): string => {
    const raw = data[field];
    if (missing(raw)) {
      if (required) issue(field, 'required', `Enter ${label}.`);
      return '';
    }
    if (typeof raw !== 'string') {
      issue(field, 'invalid_type', `Enter ${label}.`);
      return '';
    }
    const value = normalize(raw).replace(SPACE_RUN, ' ');
    if (value === '') {
      if (required) issue(field, 'required', `Enter ${label}.`);
      return '';
    }
    if (hasForbidden(value, false)) {
      issue(
        field,
        'invalid_characters',
        `${label[0]!.toUpperCase()}${label.slice(1)} contains characters that cannot be saved.`,
      );
      return '';
    }
    if (count(value) < min)
      issue(field, 'too_short', `${label[0]!.toUpperCase()}${label.slice(1)} is too short.`);
    else if (count(value) > max)
      issue(field, 'too_long', `${label[0]!.toUpperCase()}${label.slice(1)} is too long.`);
    return value;
  };
  const line1 = text(
    'line1',
    'your street address',
    QUOTE_LIMITS.addressLineMin,
    QUOTE_LIMITS.addressLineMax,
    true,
  );
  const line2 = text('line2', 'the apartment or suite', 1, QUOTE_LIMITS.addressLineMax, false);
  const city = text('city', 'your city', QUOTE_LIMITS.cityMin, QUOTE_LIMITS.cityMax, true);
  const state = text('state', 'your state or region', 1, QUOTE_LIMITS.stateMax, false);

  let postcode = '';
  if (missing(data.postcode)) issue('postcode', 'required', 'Enter your ZIP or postal code.');
  else if (typeof data.postcode !== 'string')
    issue('postcode', 'invalid_type', 'Enter your ZIP or postal code.');
  else {
    postcode = normalize(data.postcode).replace(SPACE_RUN, ' ');
    if (!POSTCODE.test(postcode)) {
      issue('postcode', 'invalid_characters', 'Enter a valid ZIP or postal code.');
      postcode = '';
    }
  }

  let country = '';
  if (missing(data.country)) issue('country', 'required', 'Choose your country.');
  else if (typeof data.country !== 'string' || !/^[A-Za-z]{2}$/.test(data.country.trim()))
    issue('country', 'invalid_choice', 'Choose your country from the list.');
  else country = data.country.trim().toUpperCase();

  let phone = '';
  if (!missing(data.phone)) {
    if (typeof data.phone !== 'string' || !PHONE.test(data.phone.trim()))
      issue(
        'phone',
        'invalid_characters',
        'Enter a phone number with digits, spaces and + ( ) - only.',
      );
    else phone = data.phone.trim();
  }

  if (data.accepted !== true)
    issue('accepted', 'terms_required', 'Please confirm that you approve this quote.');

  if (issues.length > 0) return { ok: false, issues };
  return {
    ok: true,
    value: {
      revision: revision as number,
      line1,
      line2,
      city,
      state,
      postcode,
      country,
      phone,
      accepted: true,
    },
  };
}
