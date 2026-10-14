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
  ];
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
