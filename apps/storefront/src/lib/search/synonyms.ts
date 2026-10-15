import { foldText, singular } from './text';

/**
 * Words people use for the same thing in a game shop. Each line is one group: a search for any of them also finds the others.
 * This is a starting list of tabletop and card-game shorthand, not a claim about the owner's catalog; to change it without a
 * rebuild, set SEARCH_SYNONYMS on the server: groups separated by ";" and words inside a group by "=", for example
 * "mtg=magic the gathering;dnd=dungeons and dragons". Read at request time; a bad entry is ignored.
 */
export const DEFAULT_SYNONYM_GROUPS: readonly (readonly string[])[] = [
  ['mtg', 'magic the gathering'],
  ['dnd', 'd and d', 'dungeons and dragons'],
  ['tcg', 'trading card game'],
  ['ccg', 'collectible card game'],
  ['deck box', 'deckbox', 'card box'],
  ['organizer', 'organiser', 'insert'],
  ['minis', 'miniatures', 'miniature'],
  ['rpg', 'role playing game'],
];

export function parseSynonymGroups(text: string | undefined): string[][] {
  if (!text) return [];
  const groups: string[][] = [];
  for (const part of text.split(';').slice(0, 200)) {
    const words = part
      .split('=')
      .map((w) => foldText(w))
      .filter((w) => w !== '' && w.length <= 60);
    if (words.length >= 2) groups.push(words.slice(0, 12));
  }
  return groups;
}

export type SynonymMap = Map<string, string[][]>;

/** phrase (folded, singular words) -> the OTHER phrases in its groups, each as a list of words. */
export function buildSynonymMap(groups: readonly (readonly string[])[]): SynonymMap {
  const map: SynonymMap = new Map();
  const phraseWords = (phrase: string) =>
    foldText(phrase)
      .split(' ')
      .filter(Boolean)
      .map((w) => singular(w));
  for (const group of groups) {
    const phrases = group.map(phraseWords).filter((words) => words.length > 0);
    for (const phrase of phrases) {
      const key = phrase.join(' ');
      const others = phrases.filter((p) => p.join(' ') !== key);
      const known = map.get(key) ?? [];
      for (const other of others) {
        if (!known.some((k) => k.join(' ') === other.join(' '))) known.push(other);
      }
      map.set(key, known);
    }
  }
  return map;
}
