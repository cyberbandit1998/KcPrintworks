/**
 * Text helpers for product search. Pure: the same folding is applied to the catalog (when the index is built) and to what a shopper
 * types, so "Café", "cafe" and "CAFE" are one word, and "cases" finds "case".
 */

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  rsquo: "'",
  lsquo: "'",
  rdquo: '"',
  ldquo: '"',
  ndash: '-',
  mdash: '-',
  hellip: ' ',
  times: 'x',
};

/** Product descriptions are HTML from WooCommerce: take the words only. Never rendered, so this only has to find words, not be safe markup. */
export function stripHtml(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, body: string) => {
      if (body[0] === '#') {
        const code =
          body[1]?.toLowerCase() === 'x'
            ? Number.parseInt(body.slice(2), 16)
            : Number(body.slice(1));
        return Number.isFinite(code) && code > 0 && code < 0x110000
          ? String.fromCodePoint(code)
          : ' ';
      }
      return ENTITIES[body.toLowerCase()] ?? whole;
    });
}

/** Lower case, accents and ligatures removed, "&" read as "and", anything that is not a letter or digit becomes a space. */
export function foldText(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/æ/g, 'ae')
    .replace(/œ/g, 'oe')
    .replace(/ø/g, 'o')
    .replace(/đ/g, 'd')
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Plural folding on a folded word: "cases" and "case" are the same word, "boxes" and "box", "accessories" and "accessory". */
export function singular(word: string): string {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && /(?:sses|xes|zes|ches|shes)$/.test(word)) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s') && !/(?:ss|us|is)$/.test(word))
    return word.slice(0, -1);
  return word;
}

/** Words that carry no meaning in a search ("case for the game"): dropped from a query when something else is left. */
export const STOP_WORDS: ReadonlySet<string> = new Set([
  'a',
  'an',
  'and',
  'for',
  'in',
  'of',
  'on',
  'or',
  'the',
  'to',
  'with',
]);

export function tokenize(text: string): string[] {
  const folded = foldText(text);
  return folded === '' ? [] : folded.split(' ');
}

/**
 * Is `a` within `max` edits of `b`? An edit is an inserted, deleted or changed letter, or two neighbouring letters swapped (the usual
 * typing mistake). Gives up early once the words are too far apart, so scanning a whole vocabulary stays cheap.
 */
export function withinEdits(a: string, b: string, max: number): number | null {
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > max) return null;
  let previous: number[] = [];
  let current: number[] = [];
  let beforePrevious: number[] = [];
  for (let j = 0; j <= lb; j += 1) previous[j] = j;
  for (let i = 1; i <= la; i += 1) {
    current = [i];
    let rowMin = i;
    for (let j = 1; j <= lb; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(
        (previous[j] ?? 0) + 1,
        (current[j - 1] ?? 0) + 1,
        (previous[j - 1] ?? 0) + cost,
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, (beforePrevious[j - 2] ?? 0) + 1);
      }
      current[j] = value;
      if (value < rowMin) rowMin = value;
    }
    if (rowMin > max) return null;
    beforePrevious = previous;
    previous = current;
  }
  const distance = previous[lb] ?? 0;
  return distance <= max ? distance : null;
}
