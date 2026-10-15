import { describe, expect, it } from 'vitest';
import { CategorySchema, ProductSchema, money, type Category, type Product } from '@kcpw/contracts';
import { cleanQuery, displayCategory, toHitDto } from '@/lib/search/hit';
import { buildSearchIndex, getSearchIndex, searchProducts } from '@/lib/search/index';
import { buildSynonymMap, parseSynonymGroups } from '@/lib/search/synonyms';
import { foldText, singular, stripHtml, tokenize, withinEdits } from '@/lib/search/text';
import { quoteHref, searchHref } from '@/lib/search/url';
import { createCatalogSource } from '@/lib/catalog/derive';

const cat = (id: number, slug: string, name: string, parentId = 0): Category =>
  CategorySchema.parse({
    id,
    slug,
    name,
    description: '',
    seo: { title: name, description: name, noindex: false },
    parentId,
    menuOrder: 0,
  });

const categories = [
  cat(15, 'uncategorized', 'Uncategorized'),
  cat(417, 'game-cases', 'Game Cases'),
  cat(332, 'card-games', 'Card Games', 417),
  cat(418, 'personalized-gifts', 'Personalized Gifts'),
  cat(370, 'desk-toys', 'Desk Toys'),
];

function product(id: number, name: string, categoryIds: number[], extra: Partial<Product> = {}) {
  return ProductSchema.parse({
    id,
    slug: foldText(name).replace(/ /g, '-') || `p-${id}`,
    type: 'simple',
    name,
    descriptionHtml: '',
    shortDescription: '',
    price: money(1500),
    images: [],
    categories: categoryIds.map((cid) => {
      const c = categories.find((x) => x.id === cid)!;
      return { id: c.id, slug: c.slug, name: c.name };
    }),
    attributes: [],
    variations: [],
    optionSchema: { version: 1, fields: [] },
    availability: { purchasable: true, stockStatus: 'instock', madeToOrder: false },
    seo: { title: name, description: name, noindex: false },
    updatedAt: '2026-10-01T00:00:00Z',
    ...extra,
  });
}

const catalog = [
  product(1, 'Settlers of Catan Case', [332], {
    sku: 'CAT-001',
    descriptionHtml: '<p>A sturdy case for the <strong>base game</strong> &amp; expansions.</p>',
  }),
  product(2, 'Magic Deck Box', [332], { descriptionHtml: '<p>Holds 100 sleeved cards.</p>' }),
  product(3, 'Personalized Bag Tag', [418], {
    attributes: [
      {
        slug: 'icon',
        name: 'Icon',
        usedForVariations: false,
        options: [
          { slug: 'dog', name: 'Dog' },
          { slug: 'cat', name: 'Cat' },
        ],
      },
    ],
  }),
  product(4, 'Desk Dragon', [370], {
    shortDescription: 'A flexible articulated dragon for your desk.',
  }),
  product(5, 'Café Coaster Set', [370]),
  product(6, 'Dungeons Dice Tower', [417]),
  product(7, 'Uncategorized Thing', [15]),
  product(8, 'Catan Seafarers Insert', [332], { featured: true }),
];
const index = buildSearchIndex(catalog, categories);
const names = (q: string, opts?: Parameters<typeof searchProducts>[2]) =>
  searchProducts(index, q, opts).hits.map((h) => h.product.name);

describe('text helpers', () => {
  it('folds case, accents, ligatures and punctuation', () => {
    expect(foldText('  Café — ÆON & Ørsted!  ')).toBe('cafe aeon and orsted');
    expect(tokenize('D&D 5e')).toEqual(['d', 'and', 'd', '5e']);
    expect(foldText('')).toBe('');
  });
  it('reads plurals as the same word', () => {
    expect(singular('cases')).toBe('case');
    expect(singular('boxes')).toBe('box');
    expect(singular('accessories')).toBe('accessory');
    expect(singular('glass')).toBe('glass');
    expect(singular('dice')).toBe('dice');
    expect(singular('bus')).toBe('bus');
  });
  it('strips markup and decodes entities without keeping script text', () => {
    expect(
      stripHtml('<p>Fits &amp; folds &#8217; &#x41;<script>evil()</script></p>')
        .replace(/\s+/g, ' ')
        .trim(),
    ).toBe('Fits & folds ’ A');
    expect(stripHtml('&#99999999999;')).not.toContain('undefined');
  });
  it('counts a swapped pair, a missing, an extra and a wrong letter as one edit', () => {
    expect(withinEdits('catna', 'catan', 1)).toBe(1);
    expect(withinEdits('catn', 'catan', 1)).toBe(1);
    expect(withinEdits('cattan', 'catan', 1)).toBe(1);
    expect(withinEdits('catam', 'catan', 1)).toBe(1);
    expect(withinEdits('catan', 'catan', 1)).toBe(0);
    expect(withinEdits('xxxxx', 'catan', 1)).toBeNull();
    expect(withinEdits('a', 'abcdefgh', 2)).toBeNull();
  });
});

describe('searching', () => {
  it('finds a whole word in the name, ignoring case and accents', () => {
    expect(names('catan')).toEqual(['Catan Seafarers Insert', 'Settlers of Catan Case']);
    expect(names('CAFE')).toEqual(['Café Coaster Set']);
    expect(names('café')).toEqual(['Café Coaster Set']);
    expect(names('CATAN')).toEqual(['Catan Seafarers Insert', 'Settlers of Catan Case']);
  });
  it('finds partial words: the start of a longer word, and a part inside one', () => {
    expect(names('cat')).toContain('Settlers of Catan Case');
    expect(names('dung')).toEqual(['Dungeons Dice Tower']);
    expect(names('ower')).toEqual(['Dungeons Dice Tower']);
  });
  it('forgives one typo in a long enough word and two in a very long one, but not in short words or numbers', () => {
    expect(names('catna')).toContain('Settlers of Catan Case');
    expect(names('settlres')).toEqual(['Settlers of Catan Case']);
    expect(names('dungeoons')).toEqual(['Dungeons Dice Tower']); // one extra letter
    expect(names('dungoeons')).toEqual(['Dungeons Dice Tower']); // two slips in a nine-letter word
    expect(names('dungoxn')).toEqual([]); // two slips in a seven-letter word is too far
    expect(names('cafe')).toEqual(['Café Coaster Set']); // four letters: no guessing, so "case" is not offered
    expect(names('dxg')).toEqual([]);
    expect(names('5x')).toEqual([]);
  });
  it('reads plurals both ways', () => {
    expect(names('cases')).toContain('Settlers of Catan Case');
    expect(names('boxes')).toContain('Magic Deck Box');
    expect(names('dragons')).toContain('Desk Dragon');
  });
  it('needs every word of the query, in any order', () => {
    // "case" is in the first one's name and in the other's category (Game Cases): both qualify, the name match ranks first.
    expect(names('case catan')).toEqual(['Settlers of Catan Case', 'Catan Seafarers Insert']);
    expect(names('catan case')).toEqual(['Settlers of Catan Case', 'Catan Seafarers Insert']);
    expect(names('catan dragon')).toEqual([]);
  });
  it('ignores filler words when something else is left, and keeps them when nothing is', () => {
    expect(names('case for the catan')).toEqual([
      'Settlers of Catan Case',
      'Catan Seafarers Insert',
    ]);
    // Only filler: it is searched as typed rather than returning nothing for "the".
    expect(searchProducts(index, 'the').terms).toEqual(['the']);
  });
  it('searches the description, the SKU, option names and short descriptions', () => {
    expect(names('sturdy')).toEqual(['Settlers of Catan Case']);
    expect(names('expansions')).toEqual(['Settlers of Catan Case']);
    expect(names('cat-001')).toEqual(['Settlers of Catan Case']);
    expect(names('sleeved')).toEqual(['Magic Deck Box']);
    expect(names('articulated')).toEqual(['Desk Dragon']);
    expect(names('dog')).toEqual(['Personalized Bag Tag']);
  });
  it('searches category names, including the parent categories', () => {
    expect(names('card games')).toContain('Magic Deck Box');
    expect(names('game cases')).toEqual(
      expect.arrayContaining(['Magic Deck Box', 'Settlers of Catan Case', 'Dungeons Dice Tower']),
    );
    expect(names('personalised gifts')).toEqual(['Personalized Bag Tag']); // another spelling is one letter off
    expect(names('personalized gifts')).toEqual(['Personalized Bag Tag']);
  });
  it('ranks a name match above a description match, and an exact name above a partial one', () => {
    const rank = names('catan');
    expect(rank[0]).toBe('Catan Seafarers Insert'); // featured breaks the tie between two name matches
    const d = buildSearchIndex(
      [
        product(10, 'Plain Box', [370], { descriptionHtml: '<p>Great for dragon fans</p>' }),
        product(11, 'Dragon', [370]),
        product(12, 'Dragonfly Lamp', [370]),
      ],
      categories,
    );
    expect(searchProducts(d, 'dragon').hits.map((h) => h.product.name)).toEqual([
      'Dragon',
      'Dragonfly Lamp',
      'Plain Box',
    ]);
  });
  it('finds a name written as one word or two', () => {
    const d = buildSearchIndex([product(20, 'Gamecase Deluxe', [417])], categories);
    expect(searchProducts(d, 'game case').hits).toHaveLength(1);
    const e = buildSearchIndex([product(21, 'Deck Box Mini', [417])], categories);
    expect(searchProducts(e, 'deckbox').hits).toHaveLength(1);
  });
  it('uses listed synonyms, both ways, and the owner can add more without a rebuild', () => {
    const d = buildSearchIndex(
      [
        product(30, 'Magic: The Gathering Case', [332]),
        product(31, 'Dungeons and Dragons Tin', [332]),
      ],
      categories,
    );
    expect(searchProducts(d, 'mtg').hits.map((h) => h.product.id)).toEqual([30]);
    expect(searchProducts(d, 'dnd').hits.map((h) => h.product.id)).toEqual([31]);
    expect(searchProducts(d, 'magic the gathering').hits.map((h) => h.product.id)).toEqual([30]);
    const withEnv = getSearchIndex(
      [product(32, 'Warhammer Case', [332])],
      categories,
      'wh=warhammer;broken;=;x=',
    );
    expect(searchProducts(withEnv, 'wh').hits).toHaveLength(1);
    expect(parseSynonymGroups('a=b;c')).toEqual([['a', 'b']]);
    expect(parseSynonymGroups(undefined)).toEqual([]);
    expect(buildSynonymMap([['mtg', 'magic the gathering']]).get('mtg')).toEqual([
      ['magic', 'the', 'gathering'],
    ]);
  });
  it('limits the result to a category and everything below it', () => {
    const game = new Set([417, 332]);
    expect(names('case', { categoryIds: game }).length).toBeGreaterThan(0);
    expect(names('case', { categoryIds: new Set([370]) })).toEqual([]);
    expect(names('dragon', { categoryIds: new Set([370]) })).toEqual(['Desk Dragon']);
  });
  it('returns nothing for an empty, one-letter, or meaningless query, and never throws on hostile text', () => {
    for (const q of ['', ' ', 'a', '!!!', '%', '\u0000', 'x'.repeat(500), '(((', '\\']) {
      expect(() => searchProducts(index, q)).not.toThrow();
    }
    expect(searchProducts(index, '').hits).toEqual([]);
    expect(searchProducts(index, 'a').hits).toEqual([]);
    expect(names('catan'.repeat(40))).toEqual([]);
  });
  it('is fast on a large catalog', () => {
    const many = Array.from({ length: 1500 }, (_, i) =>
      product(1000 + i, `Game Case ${i} Deluxe Edition`, [332], {
        descriptionHtml: `<p>Holds ${i} cards and plenty of other things for tabletop evenings.</p>`,
      }),
    );
    const big = buildSearchIndex(many, categories);
    const started = performance.now();
    for (let i = 0; i < 20; i += 1) searchProducts(big, 'gamr casse deluxx');
    expect((performance.now() - started) / 20).toBeLessThan(120);
  });
});

describe('only what the shop lists is searchable, and a refresh makes changes searchable', () => {
  it('indexes exactly the products the catalog source hands over (hidden and unpublished are never handed over)', async () => {
    let products = [product(1, 'Alpha Case', [332])];
    let cats = categories;
    const source = createCatalogSource(() => ({ products, categories: cats }));
    const first = await source.listProducts();
    const a = getSearchIndex(first, await source.listAllCategories(), '');
    expect(searchProducts(a, 'alpha').hits).toHaveLength(1);
    expect(searchProducts(a, 'beta').hits).toHaveLength(0);
    // The same copy gives the same index (free); a refresh gives a new copy and so a new index.
    expect(getSearchIndex(first, await source.listAllCategories(), '')).toBe(a);
    products = [product(1, 'Alpha Case', [332]), product(2, 'Beta Case', [332])];
    cats = [...categories];
    const second = await source.listProducts();
    const b = getSearchIndex(second, await source.listAllCategories(), '');
    expect(b).not.toBe(a);
    expect(searchProducts(b, 'beta').hits).toHaveLength(1);
  });
  it('a renamed product is found by its new name and no longer by the old one', () => {
    const before = buildSearchIndex([product(1, 'Old Name Case', [332])], categories);
    const after = buildSearchIndex([product(1, 'Shiny New Case', [332])], categories);
    expect(searchProducts(before, 'old').hits).toHaveLength(1);
    expect(searchProducts(after, 'old').hits).toHaveLength(0);
    expect(searchProducts(after, 'shiny').hits).toHaveLength(1);
  });
});

describe('results for the live list', () => {
  const hidden = new Set(['uncategorized']);
  it('shows the first category the shop shows, never a hidden one', () => {
    const p = product(1, 'X', [15, 332]);
    expect(displayCategory(p, categories, hidden)?.name).toBe('Card Games');
    expect(displayCategory(product(2, 'Y', [15]), categories, hidden)).toBeUndefined();
  });
  it('carries what a row needs and nothing more', () => {
    const dto = toHitDto(
      product(3, 'Tag', [418], {
        images: [{ id: 1, url: 'https://shop.example/a.jpg', alt: 'A', width: 400, height: 300 }],
      }),
      categories,
      hidden,
    );
    expect(Object.keys(dto).sort()).toEqual([
      'category',
      'from',
      'id',
      'image',
      'name',
      'price',
      'slug',
    ]);
    expect(dto.from).toBe(false);
    expect(dto.image).toEqual({ url: 'https://shop.example/a.jpg', width: 400, height: 300 });
  });
  it('cleans a query: control characters out, spaces collapsed, 80 characters at most', () => {
    expect(cleanQuery('  a\u0000b‮   c  ')).toBe('a b c');
    expect(cleanQuery('x'.repeat(200))).toHaveLength(80);
    expect(cleanQuery(['one', 'two'])).toBe('one');
    expect(cleanQuery(5)).toBe('');
    expect(cleanQuery(undefined)).toBe('');
  });
  it('builds addresses for the search and quote pages', () => {
    expect(searchHref()).toBe('/search/');
    expect(searchHref({ q: 'a b', category: 'x', page: 3 })).toBe(
      '/search/?q=a+b&category=x&page=3',
    );
    expect(searchHref({ q: 'a', page: 1 })).toBe('/search/?q=a');
    expect(quoteHref()).toBe('/custom-orders/');
    expect(quoteHref(' Ticket to Ride ')).toBe('/custom-orders/?item=Ticket%20to%20Ride');
    expect(quoteHref('x'.repeat(300)).length).toBeLessThan(200);
  });
});
