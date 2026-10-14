// SYNTHETIC WooCommerce REST v3 data for tests. It mirrors the shapes the real store returns (including the odd ones: blank
// "Any" variation attributes, marketplace attributes, HTML entities, a draft, a row that is not a product) but describes
// no real product. Never replace it with data copied from the live store.

const TAG_COLORS = [
  'Black',
  'White',
  'Red',
  'Blue',
  'Navy',
  'Green',
  'Pink',
  'Purple',
  'Orange',
  'Yellow',
  'Gray',
  'Teal',
  'Gold',
];

function image(id, host, name) {
  return { id, src: `${host}/images/${name}.svg`, name, alt: '' };
}

export function createFixture(host = 'http://127.0.0.1:3200') {
  const categories = [
    { id: 15, name: 'Uncategorized', slug: 'uncategorized', description: '', count: 1 },
    {
      id: 20,
      name: 'Gifts &amp; Keepsakes',
      slug: 'gifts-keepsakes',
      description: '<p>Personalized gifts.</p>',
      count: 4,
    },
    { id: 21, name: 'Game Accessories', slug: 'game-accessories', description: '', count: 3 },
    { id: 22, name: 'Empty Category', slug: 'empty-category', description: '', count: 0 },
    // The real shop's structure as the owner verified it: "Game Cases" (417) is a parent with no products of its own and "Card Games"
    // (332) is its child; "Personalized Gifts" (418) stands alone; "New Arrivals" (324) is the category a plugin rotates products through.
    { id: 324, name: 'New Arrivals', slug: 'new-arrivals', description: '', count: 1 },
    { id: 417, name: 'Game Cases', slug: 'game-cases', description: '', count: 0 },
    { id: 332, name: 'Card Games', slug: 'card-games', description: '', count: 3, parent: 417 },
    { id: 418, name: 'Personalized Gifts', slug: 'personalized-gifts', description: '', count: 1 },
  ].map((c) => ({ parent: 0, menu_order: 0, image: null, ...c }));
  const cat = (id) => {
    const c = categories.find((x) => x.id === id);
    return { id: c.id, name: c.name, slug: c.slug };
  };
  const base = {
    type: 'simple',
    status: 'publish',
    catalog_visibility: 'visible',
    description: '',
    short_description: '',
    sku: '',
    price: '',
    regular_price: '',
    sale_price: '',
    on_sale: false,
    stock_status: 'instock',
    categories: [],
    images: [],
    attributes: [],
    variations: [],
    date_modified_gmt: '2026-09-01T12:00:00',
    meta_data: [],
    featured: false,
    date_created_gmt: '2026-09-01T09:00:00',
    date_created: '2026-09-01T05:00:00',
    menu_order: 0,
    average_rating: '0.00',
    rating_count: 0,
    reviews_allowed: true,
  };
  const product = (fields) => ({ ...base, ...fields });

  // 169 variations, every attribute blank ("Any"): the shape of the real bag tag.
  const anyVariations = Array.from({ length: 169 }, (_, i) => ({
    id: 5000 + i,
    sku: `SYN-BAG-${i}`,
    status: 'publish',
    price: '12.00',
    regular_price: '12.00',
    sale_price: '',
    on_sale: false,
    stock_status: 'instock',
    attributes: [
      { name: 'Tag Color', option: '' },
      { name: 'Text Color', option: '' },
    ],
  }));

  const products = [
    product({
      id: 101,
      name: 'Synthetic Personalized Keychain',
      slug: 'synthetic-personalized-keychain',
      sku: 'SYN-KEY',
      price: '8.99',
      regular_price: '8.99',
      description: '<p>A <strong>keychain</strong> with your name.</p><script>alert(1)</script>',
      short_description: '<p>Your name, printed.</p>',
      categories: [cat(20)],
      images: [image(9001, host, 'keychain')],
      date_modified_gmt: '2026-09-02T08:30:00',
    }),
    product({
      id: 102,
      name: 'Synthetic Bag Tag',
      slug: 'synthetic-bag-tag',
      type: 'variable',
      sku: 'SYN-BAG',
      price: '12.00',
      regular_price: '12.00',
      categories: [cat(20)],
      images: [image(9002, host, 'bag-tag')],
      attributes: [
        { id: 0, name: 'Tag Color', visible: true, variation: true, options: TAG_COLORS },
        { id: 0, name: 'Text Color', visible: true, variation: true, options: TAG_COLORS },
        { id: 0, name: 'Condition', visible: false, variation: false, options: ['MADE_TO_ORDER'] },
      ],
      variations: anyVariations.map((v) => v.id),
    }),
    product({
      id: 103,
      name: 'Synthetic Card Box &amp; Sleeves',
      slug: 'synthetic-card-box',
      type: 'variable',
      price: '12.50',
      regular_price: '15.00',
      sale_price: '12.50',
      on_sale: true,
      categories: [cat(21)],
      images: [image(9003, host, 'card-box'), image(9004, host, 'card-box-2')],
      attributes: [
        {
          id: 0,
          name: 'Color',
          visible: true,
          variation: true,
          options: ['Red', 'Blue', 'Dark Green'],
        },
      ],
      variations: [7001, 7002, 7003, 7004],
    }),
    product({
      id: 104,
      name: 'Synthetic Draft Product',
      slug: 'synthetic-draft',
      status: 'draft',
      price: '5.00',
      regular_price: '5.00',
      categories: [cat(21)],
    }),
    product({
      id: 105,
      name: 'Synthetic Out Of Stock Stand',
      slug: 'synthetic-stand',
      price: '20.00',
      regular_price: '20.00',
      stock_status: 'outofstock',
      categories: [cat(21)],
      images: [image(9005, host, 'stand')],
      attributes: [
        { id: 0, name: 'Condition', visible: true, variation: false, options: ['NEW'] },
        { id: 0, name: 'MPN', visible: true, variation: false, options: ['ABC-123'] },
      ],
    }),
    product({
      id: 106,
      name: 'Synthetic Engraved Plaque',
      slug: 'synthetic-plaque',
      price: '30.00',
      regular_price: '30.00',
      categories: [cat(20)],
      images: [image(9006, host, 'plaque')],
      meta_data: [
        {
          key: '_kcpw_option_schema',
          value: JSON.stringify({
            version: 1,
            fields: [
              {
                id: 'inscription',
                type: 'text',
                label: 'Inscription',
                required: true,
                maxLength: 30,
              },
            ],
          }),
        },
      ],
    }),
    product({
      id: 107,
      name: 'Synthetic Photo From Elsewhere',
      slug: 'synthetic-elsewhere',
      price: '9.00',
      regular_price: '9.00',
      categories: [cat(20)],
      images: [
        {
          id: 9007,
          src: 'https://cdn.example.net/photo.jpg',
          name: 'photo',
          alt: 'A photo on another host',
        },
      ],
    }),
    product({
      id: 108,
      name: 'Synthetic Hidden Item',
      slug: 'synthetic-hidden',
      catalog_visibility: 'hidden',
      price: '4.00',
      regular_price: '4.00',
      categories: [cat(21)],
    }),
    product({
      id: 109,
      name: 'Synthetic Uncategorized Thing',
      slug: 'synthetic-uncategorized',
      price: '3.00',
      regular_price: '3.00',
      categories: [cat(15)],
    }),
    // ---- merchandising, dates and ratings (ids 201 and up)
    product({
      id: 201,
      name: 'Synthetic Card Case Alpha',
      slug: 'synthetic-card-case-alpha',
      price: '11.00',
      regular_price: '11.00',
      categories: [cat(332)],
      images: [image(9101, host, 'card-case-a')],
      featured: true,
      menu_order: 2,
      date_created_gmt: '2026-10-10T10:00:00',
      average_rating: '4.50',
      rating_count: 2,
    }),
    product({
      id: 202,
      name: 'Synthetic Card Case Beta',
      slug: 'synthetic-card-case-beta',
      price: '13.00',
      regular_price: '13.00',
      categories: [cat(332), cat(417)], // in the child AND the parent: must appear once on the parent's page
      images: [image(9102, host, 'card-case-b')],
      featured: true,
      menu_order: 1,
      date_created_gmt: '2026-10-12T10:00:00',
    }),
    product({
      id: 203,
      name: 'Synthetic Gift Mug',
      slug: 'synthetic-gift-mug',
      price: '16.00',
      regular_price: '16.00',
      categories: [cat(418)],
      images: [image(9103, host, 'gift-mug')],
      date_created_gmt: '2026-10-11T10:00:00',
    }),
    product({
      id: 204,
      name: 'Synthetic Direct Game Case',
      slug: 'synthetic-direct-game-case',
      price: '25.00',
      regular_price: '25.00',
      categories: [cat(417)],
      images: [image(9104, host, 'direct-case')],
      date_created_gmt: '2026-10-09T10:00:00',
    }),
    product({
      id: 205,
      name: 'Synthetic Old Arrival',
      slug: 'synthetic-old-arrival',
      price: '7.00',
      regular_price: '7.00',
      categories: [cat(324)], // in the New Arrivals CATEGORY but published long ago: must not be a "new arrival"
      images: [image(9105, host, 'old-arrival')],
      date_created_gmt: '2026-01-01T10:00:00',
    }),
    product({
      id: 206,
      name: 'Synthetic Reviews Off',
      slug: 'synthetic-reviews-off',
      price: '6.00',
      regular_price: '6.00',
      categories: [cat(418)],
      reviews_allowed: false,
      date_created_gmt: '2026-10-08T10:00:00',
    }),
  ];

  const variations = new Map();
  variations.set(102, anyVariations);
  variations.set(103, [
    {
      id: 7001,
      sku: 'SYN-CB-R',
      status: 'publish',
      price: '12.50',
      regular_price: '15.00',
      sale_price: '12.50',
      on_sale: true,
      stock_status: 'instock',
      attributes: [{ name: 'Color', option: 'Red' }],
    },
    {
      id: 7002,
      sku: 'SYN-CB-B',
      status: 'publish',
      price: '12.50',
      regular_price: '15.00',
      sale_price: '12.50',
      on_sale: true,
      stock_status: 'outofstock',
      attributes: [{ name: 'Color', option: 'Blue' }],
    },
    {
      id: 7003,
      sku: 'SYN-CB-G',
      status: 'publish',
      price: '14.00',
      regular_price: '14.00',
      sale_price: '',
      on_sale: false,
      stock_status: 'instock',
      attributes: [{ name: 'Color', option: 'Dark Green' }],
    },
    {
      id: 7004,
      sku: 'SYN-CB-X',
      status: 'private',
      price: '99.00',
      regular_price: '99.00',
      sale_price: '',
      on_sale: false,
      stock_status: 'instock',
      attributes: [{ name: 'Color', option: 'Red' }],
    },
  ]);

  return { categories, products, variations };
}
