import type { Category, Product } from '@kcpw/contracts';
import {
  buildSynonymMap,
  DEFAULT_SYNONYM_GROUPS,
  parseSynonymGroups,
  type SynonymMap,
} from './synonyms';
import { foldText, singular, STOP_WORDS, stripHtml, tokenize, withinEdits } from './text';

/**
 * Product search over the catalog the storefront already holds in memory. Nothing here asks WooCommerce or WordPress anything: the
 * index is built from the cached catalog the first time it is needed and rebuilt, automatically, when the cache loads a new copy (a
 * refresh gives a new product list, and the index is remembered against that list). Only products the catalog lists are in it, which
 * means published ones that are not hidden from the catalog.
 *
 * Matching: every word of the query must be found, in the name, the category names (with their parent categories), the SKU, the
 * option names (sizes, finishes, game names) or the description. A word matches whole, as the start of a longer word ("cat" finds
 * "Catan"), inside a word, with a plural ("cases"), through a listed synonym ("mtg"), or with a typo (one wrong, missing, extra or
 * swapped letter in a word of five letters or more; two in words of nine or more). Names count most, descriptions least.
 */

const WEIGHTS = { name: 10, sku: 8, category: 4, option: 2.5, text: 1.2 } as const;
type FieldName = keyof typeof WEIGHTS;

const MAX_QUERY_CHARS = 80;
const MAX_QUERY_TERMS = 8;

interface Field {
  /** word (folded, singular) -> indexes of the products that have it in this field */
  words: Map<string, number[]>;
}

interface Doc {
  product: Product;
  nameFolded: string;
  nameCompact: string;
}

export interface SearchIndex {
  docs: Doc[];
  fields: Record<FieldName, Field>;
  synonyms: SynonymMap;
}

export interface SearchHit {
  product: Product;
  score: number;
}

export interface SearchResult {
  /** The words searched for, folded; empty when the query had nothing to search for. */
  terms: string[];
  hits: SearchHit[];
}

function addWords(field: Field, text: string, docIndex: number) {
  for (const raw of tokenize(text)) {
    const word = singular(raw);
    if (word === '') continue;
    const list = field.words.get(word);
    if (!list) field.words.set(word, [docIndex]);
    else if (list[list.length - 1] !== docIndex) list.push(docIndex);
  }
}

function categoryNames(product: Product, categories: readonly Category[]): string[] {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const names: string[] = [];
  const seen = new Set<number>();
  for (const ref of product.categories) {
    let current: Category | undefined = byId.get(ref.id);
    // Walk up, so a product in "Magic: The Gathering" is also found by its parent "Card Game Cases". A loop ends the walk.
    for (let depth = 0; current && depth < 8 && !seen.has(current.id); depth += 1) {
      seen.add(current.id);
      names.push(current.name);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    if (!byId.has(ref.id) && ref.name) names.push(ref.name);
  }
  return names;
}

export function buildSearchIndex(
  products: readonly Product[],
  categories: readonly Category[],
  synonymGroups: readonly (readonly string[])[] = DEFAULT_SYNONYM_GROUPS,
): SearchIndex {
  const fields: Record<FieldName, Field> = {
    name: { words: new Map() },
    sku: { words: new Map() },
    category: { words: new Map() },
    option: { words: new Map() },
    text: { words: new Map() },
  };
  const docs: Doc[] = products.map((product, index) => {
    addWords(fields.name, product.name, index);
    if (product.sku) addWords(fields.sku, product.sku, index);
    addWords(fields.category, categoryNames(product, categories).join(' '), index);
    addWords(
      fields.option,
      product.attributes
        .map((a) => `${a.name} ${a.options.map((o) => o.name).join(' ')}`)
        .join(' '),
      index,
    );
    addWords(
      fields.text,
      `${stripHtml(product.shortDescription)} ${stripHtml(product.descriptionHtml)}`,
      index,
    );
    const nameFolded = foldText(product.name);
    return { product, nameFolded, nameCompact: nameFolded.replace(/ /g, '') };
  });
  return { docs, fields, synonyms: buildSynonymMap(synonymGroups) };
}

// ---------------------------------------------------------------------------------------------------------- matching

/** How good a match is, 0 to 1, between a typed word and a word of the catalog (both folded, singular). */
function quality(typed: string, word: string): number {
  if (typed === word) return 1;
  if (typed.length >= 2 && word.startsWith(typed)) return 0.8;
  if (typed.length >= 3 && word.includes(typed)) return 0.5;
  // A typo only forgives words long enough to leave no doubt ("cafe" must not find "case"), and never a word with a digit ("5e" is not "5x").
  if (typed.length >= 5 && !/\d/.test(typed)) {
    const max = typed.length >= 9 ? 2 : 1;
    const distance = withinEdits(typed, word, max);
    if (distance !== null) return distance === 1 ? 0.65 : 0.5;
  }
  return 0;
}

/** For one typed word: product index -> its best score for that word across all fields. */
function scoreWord(index: SearchIndex, typed: string): Map<number, number> {
  const perDoc = new Map<number, { max: number; sum: number }>();
  for (const name of Object.keys(WEIGHTS) as FieldName[]) {
    const best = new Map<number, number>();
    const exact = index.fields[name].words.get(typed);
    if (exact) for (const doc of exact) best.set(doc, 1);
    for (const [word, docIndexes] of index.fields[name].words) {
      if (word === typed) continue;
      const q = quality(typed, word);
      if (q === 0) continue;
      for (const doc of docIndexes) if ((best.get(doc) ?? 0) < q) best.set(doc, q);
    }
    for (const [doc, q] of best) {
      const value = q * WEIGHTS[name];
      const current = perDoc.get(doc);
      if (!current) perDoc.set(doc, { max: value, sum: value });
      else {
        current.max = Math.max(current.max, value);
        current.sum += value;
      }
    }
  }
  const out = new Map<number, number>();
  // The best field counts in full, other fields a little ("Catan" in the name AND the description ranks above name only).
  for (const [doc, v] of perDoc) out.set(doc, v.max + 0.15 * (v.sum - v.max));
  return out;
}

interface Term {
  /** The ways this part of the query can be satisfied; each way is a list of words that must ALL match. */
  alternatives: string[][];
}

/** Splits a query into terms: single words, or a listed phrase ("magic the gathering") with its synonyms as alternatives. */
function toTerms(words: string[], synonyms: SynonymMap): Term[] {
  const terms: Term[] = [];
  let i = 0;
  while (i < words.length) {
    let taken = 0;
    for (let n = Math.min(4, words.length - i); n >= 1; n -= 1) {
      const phrase = words.slice(i, i + n);
      const others = synonyms.get(phrase.join(' '));
      if (others && others.length > 0) {
        terms.push({ alternatives: [phrase, ...others] });
        taken = n;
        break;
      }
    }
    if (taken === 0) {
      terms.push({ alternatives: [[words[i]!]] });
      taken = 1;
    }
    i += taken;
  }
  return terms;
}

export function searchProducts(
  index: SearchIndex,
  rawQuery: string,
  options: { categoryIds?: ReadonlySet<number> } = {},
): SearchResult {
  const query = rawQuery.slice(0, MAX_QUERY_CHARS);
  const all = tokenize(query).slice(0, MAX_QUERY_TERMS * 2);
  const meaningful = all.filter((w) => !STOP_WORDS.has(w));
  const words = (meaningful.length > 0 ? meaningful : all).map(singular).slice(0, MAX_QUERY_TERMS);
  if (words.length === 0) return { terms: [], hits: [] };
  // One character is not a search: it would match most of the catalog.
  if (words.join('').length < 2) return { terms: words, hits: [] };

  const terms = toTerms(words, index.synonyms);
  const cache = new Map<string, Map<number, number>>();
  const wordScores = (word: string) => {
    let found = cache.get(word);
    if (!found) {
      found = scoreWord(index, word);
      cache.set(word, found);
    }
    return found;
  };

  // A product is a hit when EVERY term is satisfied; its score is the sum of the best way each term was satisfied.
  let candidates: Map<number, number> | null = null;
  for (const term of terms) {
    const termScores = new Map<number, number>();
    for (const alternative of term.alternatives) {
      let alternativeScores: Map<number, number> | null = null;
      for (const word of alternative) {
        const scores = wordScores(word);
        if (alternativeScores === null) alternativeScores = new Map(scores);
        else {
          for (const doc of [...alternativeScores.keys()]) {
            const s = scores.get(doc);
            if (s === undefined) alternativeScores.delete(doc);
            else alternativeScores.set(doc, (alternativeScores.get(doc) ?? 0) + s);
          }
        }
      }
      for (const [doc, s] of alternativeScores ?? []) {
        if (s > (termScores.get(doc) ?? 0)) termScores.set(doc, s);
      }
    }
    if (candidates === null) candidates = termScores;
    else {
      const next = new Map<number, number>();
      for (const [doc, s] of candidates) {
        const add = termScores.get(doc);
        if (add !== undefined) next.set(doc, s + add);
      }
      candidates = next;
    }
    if (candidates.size === 0) return { terms: words, hits: [] };
  }

  const phrase = words.join(' ');
  const compact = phrase.replace(/ /g, '');
  const hits: SearchHit[] = [];
  for (const [docIndex, base] of candidates ?? []) {
    const doc = index.docs[docIndex]!;
    if (
      options.categoryIds &&
      !doc.product.categories.some((c) => options.categoryIds!.has(c.id))
    ) {
      continue;
    }
    let score = base;
    if (doc.nameFolded === phrase) score += 8;
    else if (` ${doc.nameFolded} `.includes(` ${phrase} `)) score += 5;
    else if (doc.nameFolded.startsWith(phrase)) score += 2;
    if (compact.length >= 4 && doc.nameCompact.includes(compact)) score += 3;
    hits.push({ product: doc.product, score });
  }
  hits.sort(
    (a, b) =>
      b.score - a.score ||
      Number(b.product.featured) - Number(a.product.featured) ||
      a.product.menuOrder - b.product.menuOrder ||
      a.product.name.localeCompare(b.product.name, 'en', { sensitivity: 'base' }),
  );
  return { terms: words, hits };
}

// ------------------------------------------------------------------------------------------------ the shared index

const cacheKey = Symbol.for('kcpw.searchIndex');
type Holder = typeof globalThis & {
  [cacheKey]?: WeakMap<
    readonly Product[],
    { categories: readonly Category[]; synonyms: string; index: SearchIndex }
  >;
};

/**
 * The index for the catalog as it is NOW. It is remembered against the product list the catalog source returned, so while the cache
 * holds the same copy this is free, and the moment a refresh loads a new copy the next search builds a new index from it: a product
 * saved in WooCommerce is searchable after the catalog refresh, with nothing else to do.
 */
export function getSearchIndex(
  products: readonly Product[],
  categories: readonly Category[],
  synonymText: string | undefined = process.env.SEARCH_SYNONYMS,
): SearchIndex {
  const holder = globalThis as Holder;
  const store = (holder[cacheKey] ??= new WeakMap());
  const key = synonymText ?? '';
  const known = store.get(products);
  if (known && known.categories === categories && known.synonyms === key) return known.index;
  const index = buildSearchIndex(products, categories, [
    ...DEFAULT_SYNONYM_GROUPS,
    ...parseSynonymGroups(synonymText),
  ]);
  store.set(products, { categories, synonyms: key, index });
  return index;
}
