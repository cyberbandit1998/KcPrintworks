/** Text helpers for turning WooCommerce export text into storefront-ready values. */

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  rsquo: '’',
  lsquo: '‘',
  ndash: '–',
  mdash: '—',
};

export function decodeEntities(value: string): string {
  return value.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (match, dec, hex, name) => {
    if (dec) return String.fromCodePoint(Number(dec));
    if (hex) return String.fromCodePoint(parseInt(hex, 16));
    return ENTITIES[String(name).toLowerCase()] ?? match;
  });
}

/** WordPress `sanitize_title`, close enough for preview URLs: lowercase ASCII words joined by hyphens. */
export function sanitizeTitle(value: string): string {
  return decodeEntities(value)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** "13.24" -> 1324. Integer arithmetic on the string; never a float. Returns undefined when it is not a price. */
export function toMinorUnits(value: string): number | undefined {
  const match = /^\s*\$?\s*(\d{1,7})(?:\.(\d{1,2}))?\s*$/.exec(value.replace(/,/g, ''));
  if (!match) return undefined;
  return Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0') || '0');
}

/** A "Listed with <service>.com" credit line that listing/sync tools append to descriptions. Matched by shape, not by service name. */
const IMPORT_FOOTER = /(?:<br\s*\/?>|\s)*Listed with [A-Za-z0-9][A-Za-z0-9 .-]{1,40}\.com\s*$/i;

/**
 * Description HTML ready to display. The export writes line breaks as the two characters backslash-n and
 * often has no tags at all; WordPress would apply `wpautop` on the way out, so this does the same. A footer
 * left behind by an import tool is dropped from DISPLAY only (the stored description is not touched).
 */
export function descriptionHtml(raw: string): string {
  const text = raw.replace(/\\n/g, '\n').replace(/\r\n?/g, '\n').replace(IMPORT_FOOTER, '').trim();
  if (text === '') return '';
  if (/<(p|ul|ol|h[1-6]|div|table|blockquote)[\s>]/i.test(text)) return text;
  return structure(text);
}

const BULLET = /^\s*[•\u2022\-*]\s+(.*)$/;
const NUMBERED = /^\s*\d{1,2}[.)]\s+(.*)$/;
/** A short line with letters and no lowercase ones: "HOW TO ORDER". Shown as a heading, in sentence case. */
const isShout = (line: string) =>
  line.length >= 4 &&
  line.length <= 60 &&
  /[A-Z]{3}/.test(line) &&
  !/[a-z]/.test(line) &&
  !/[.!?]$/.test(line);
const sentenceCase = (line: string) => line.charAt(0) + line.slice(1).toLowerCase();

/**
 * Plain export text -> blocks: paragraphs, bullet and numbered lists, and ALL-CAPS lines as headings.
 * Display only; the stored description is not changed. Existing entities (&amp;) and tags (<br>) are kept.
 */
function structure(text: string): string {
  const out: string[] = [];
  let list: { tag: 'ul' | 'ol'; items: string[] } | undefined;
  let paragraph: string[] = [];
  const flushParagraph = () => {
    if (paragraph.length > 0) out.push(`<p>${paragraph.join('<br>')}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (list)
      out.push(`<${list.tag}>${list.items.map((i) => `<li>${i}</li>`).join('')}</${list.tag}>`);
    list = undefined;
  };
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '') {
      flushParagraph();
      flushList();
      continue;
    }
    const bullet = BULLET.exec(line);
    const numbered = NUMBERED.exec(line);
    if (bullet || numbered) {
      flushParagraph();
      const tag = bullet ? 'ul' : 'ol';
      if (list && list.tag !== tag) flushList();
      list ??= { tag, items: [] };
      list.items.push((bullet ?? numbered)![1]!.trim());
      continue;
    }
    flushList();
    if (isShout(line)) {
      flushParagraph();
      out.push(`<h3>${sentenceCase(line)}</h3>`);
      continue;
    }
    paragraph.push(line);
  }
  flushParagraph();
  flushList();
  return out.join('\n');
}

export function plainText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ') // their contents are code, not words
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

/** First ~`max` characters of text, cut at a word boundary. */
export function excerpt(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[,;:\s]+$/, '')}…`;
}
