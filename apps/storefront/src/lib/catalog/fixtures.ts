import {
  CategorySchema,
  ProductSchema,
  money,
  type Category,
  type Product,
  type ProductImage,
} from '@kcpw/contracts';

/**
 * PLACEHOLDER catalog for Step 1 design work. Every name, price, and description here is invented and
 * exists only so the storefront can be designed and tested before WooCommerce is connected (Step 2).
 * None of it describes real KCPrintWorks products.
 */

let imageId = 9000;
function image(file: string, alt: string): ProductImage {
  imageId += 1;
  return { id: imageId, url: `/fixtures/${file}`, alt, width: 800, height: 800 };
}

const UPDATED = '2026-10-13T00:00:00Z';
const PLACEHOLDER_DESCRIPTION =
  '<p>Placeholder description used for design review. Replace with real product copy from WooCommerce.</p>' +
  '<ul><li>Made to order</li><li>Personalization details are saved with your order</li></ul>';

export const categories: Category[] = [
  {
    id: 11,
    slug: 'prints',
    name: 'Prints',
    description: 'Placeholder category: personalized prints and posters.',
    seo: {
      title: 'Prints',
      description: 'Placeholder category description for prints.',
      noindex: false,
    },
  },
  {
    id: 12,
    slug: 'bags',
    name: 'Bags',
    description: 'Placeholder category: tote bags and carry goods.',
    seo: {
      title: 'Bags',
      description: 'Placeholder category description for bags.',
      noindex: false,
    },
  },
  {
    id: 13,
    slug: 'extras',
    name: 'Extras',
    description: 'Placeholder category: stickers, cards, and small items.',
    seo: {
      title: 'Extras',
      description: 'Placeholder category description for extras.',
      noindex: false,
    },
  },
].map((c) => CategorySchema.parse(c));

const cat = (slug: string) => {
  const found = categories.find((c) => c.slug === slug);
  if (!found) throw new Error(`Unknown fixture category ${slug}`);
  return { id: found.id, slug: found.slug, name: found.name };
};

const nameField = {
  id: 'name',
  type: 'text' as const,
  label: 'Name or short text',
  helpText: 'Printed exactly as you type it. Check spelling before adding to cart.',
  required: true,
  minLength: 1,
  maxLength: 24,
  placeholder: 'e.g. Ada',
};

const rawProducts = [
  {
    id: 101,
    slug: 'sample-personalized-print',
    type: 'simple',
    name: 'Sample Personalized Print',
    descriptionHtml: PLACEHOLDER_DESCRIPTION,
    shortDescription: 'Placeholder: a framed print with your own text.',
    sku: 'SAMPLE-PRINT-01',
    price: money(2400),
    images: [
      image(
        'print-a.svg',
        'Placeholder artwork: framed print with an orange circle and two text lines',
      ),
      image('print-b.svg', 'Placeholder artwork: blue square with an orange triangle'),
    ],
    categories: [cat('prints')],
    attributes: [],
    variations: [],
    optionSchema: {
      version: 1,
      fields: [
        nameField,
        {
          id: 'frame',
          type: 'select',
          label: 'Frame color',
          required: true,
          choices: [
            { value: 'black', label: 'Black' },
            { value: 'white', label: 'White' },
            { value: 'natural', label: 'Natural wood', priceEffect: { kind: 'flat', amount: 600 } },
          ],
        },
        {
          id: 'gift',
          type: 'checkbox',
          label: 'Gift wrap',
          priceEffect: { kind: 'flat', amount: 400 },
        },
      ],
    },
    availability: { purchasable: true, stockStatus: 'instock', madeToOrder: true, leadTimeDays: 5 },
    seo: {
      title: 'Sample Personalized Print',
      description: 'Placeholder SEO description for the sample personalized print.',
      noindex: false,
    },
    updatedAt: UPDATED,
  },
  {
    id: 102,
    slug: 'sample-custom-poster',
    type: 'variable',
    name: 'Sample Custom Poster',
    descriptionHtml: PLACEHOLDER_DESCRIPTION,
    shortDescription: 'Placeholder: a poster in three sizes and two finishes.',
    price: money(1800),
    images: [
      image('poster.svg', 'Placeholder artwork: poster with an orange panel and three text lines'),
    ],
    categories: [cat('prints')],
    attributes: [
      {
        slug: 'size',
        name: 'Size',
        usedForVariations: true,
        options: [
          { slug: 'small', name: 'Small (8 x 10 in)' },
          { slug: 'medium', name: 'Medium (12 x 16 in)' },
          { slug: 'large', name: 'Large (18 x 24 in)' },
        ],
      },
      {
        slug: 'finish',
        name: 'Finish',
        usedForVariations: true,
        options: [
          { slug: 'matte', name: 'Matte' },
          { slug: 'gloss', name: 'Gloss' },
        ],
      },
    ],
    variations: [
      {
        id: 1021,
        attributes: { size: 'small', finish: 'matte' },
        price: money(1800),
        stockStatus: 'instock',
      },
      {
        id: 1022,
        attributes: { size: 'small', finish: 'gloss' },
        price: money(2000),
        stockStatus: 'instock',
      },
      {
        id: 1023,
        attributes: { size: 'medium', finish: 'matte' },
        price: money(2800),
        stockStatus: 'instock',
      },
      {
        id: 1024,
        attributes: { size: 'medium', finish: 'gloss' },
        price: money(3000),
        stockStatus: 'instock',
      },
      {
        id: 1025,
        attributes: { size: 'large', finish: 'matte' },
        price: money(4200),
        stockStatus: 'instock',
      },
      {
        id: 1026,
        attributes: { size: 'large', finish: 'gloss' },
        price: money(4400),
        stockStatus: 'outofstock',
      },
    ],
    optionSchema: {
      version: 1,
      fields: [
        {
          id: 'message',
          type: 'textarea',
          label: 'Custom message',
          helpText: 'Optional. Up to 120 characters; line breaks are allowed.',
          maxLength: 120,
        },
        {
          id: 'font',
          type: 'radio',
          label: 'Font style',
          required: true,
          choices: [
            { value: 'classic', label: 'Classic' },
            { value: 'modern', label: 'Modern' },
          ],
        },
      ],
    },
    availability: { purchasable: true, stockStatus: 'instock', madeToOrder: true, leadTimeDays: 7 },
    seo: {
      title: 'Sample Custom Poster',
      description: 'Placeholder SEO description for the sample custom poster.',
      noindex: false,
    },
    updatedAt: UPDATED,
  },
  {
    id: 103,
    slug: 'sample-sticker-pack',
    type: 'simple',
    name: 'Sample Sticker Pack',
    descriptionHtml: PLACEHOLDER_DESCRIPTION,
    shortDescription: 'Placeholder: ready-made stickers, ships from stock.',
    sku: 'SAMPLE-STICKERS',
    price: money(800),
    images: [
      image(
        'stickers.svg',
        'Placeholder artwork: orange circle, blue rounded square, and a triangle',
      ),
    ],
    categories: [cat('extras')],
    attributes: [],
    variations: [],
    optionSchema: { version: 1, fields: [] },
    availability: {
      purchasable: true,
      stockStatus: 'instock',
      stockQuantity: 40,
      madeToOrder: false,
    },
    seo: {
      title: 'Sample Sticker Pack',
      description: 'Placeholder SEO description for the sample sticker pack.',
      noindex: false,
    },
    updatedAt: UPDATED,
  },
  {
    id: 104,
    slug: 'sample-tote-bag',
    type: 'variable',
    name: 'Sample Tote Bag',
    descriptionHtml: PLACEHOLDER_DESCRIPTION,
    shortDescription: 'Placeholder: a tote bag with your initials.',
    price: money(2200),
    images: [image('tote.svg', 'Placeholder artwork: tote bag with a blue circle')],
    categories: [cat('bags')],
    attributes: [
      {
        slug: 'color',
        name: 'Color',
        usedForVariations: true,
        options: [
          { slug: 'natural', name: 'Natural' },
          { slug: 'black', name: 'Black' },
        ],
      },
    ],
    variations: [
      { id: 1041, attributes: { color: 'natural' }, price: money(2200), stockStatus: 'instock' },
      { id: 1042, attributes: { color: 'black' }, price: money(2200), stockStatus: 'instock' },
    ],
    optionSchema: {
      version: 1,
      fields: [
        {
          id: 'initials',
          type: 'text',
          label: 'Initials',
          helpText: 'Up to 3 characters.',
          required: true,
          minLength: 1,
          maxLength: 3,
        },
        {
          id: 'backprint',
          type: 'select',
          label: 'Back print',
          choices: [
            { value: 'none', label: 'None' },
            {
              value: 'logo',
              label: 'Add back print',
              priceEffect: { kind: 'percent', basisPoints: 1500 },
            },
          ],
        },
      ],
    },
    availability: { purchasable: true, stockStatus: 'instock', madeToOrder: true, leadTimeDays: 6 },
    seo: {
      title: 'Sample Tote Bag',
      description: 'Placeholder SEO description for the sample tote bag.',
      noindex: false,
    },
    updatedAt: UPDATED,
  },
  {
    id: 105,
    slug: 'sample-mug',
    type: 'simple',
    name: 'Sample Mug',
    descriptionHtml: PLACEHOLDER_DESCRIPTION,
    shortDescription: 'Placeholder: sold-out state for design review.',
    sku: 'SAMPLE-MUG',
    price: money(1600),
    images: [image('mug.svg', 'Placeholder artwork: mug with an orange stripe')],
    categories: [cat('extras')],
    attributes: [],
    variations: [],
    optionSchema: { version: 1, fields: [] },
    availability: {
      purchasable: true,
      stockStatus: 'outofstock',
      stockQuantity: 0,
      madeToOrder: false,
    },
    seo: {
      title: 'Sample Mug',
      description: 'Placeholder SEO description for the sample mug.',
      noindex: false,
    },
    updatedAt: UPDATED,
  },
  {
    id: 106,
    slug: 'sample-card-set',
    type: 'simple',
    name: 'Sample Card Set',
    descriptionHtml: PLACEHOLDER_DESCRIPTION,
    shortDescription: 'Placeholder: a set of cards, shown on sale.',
    sku: 'SAMPLE-CARDS',
    price: money(1400),
    regularPrice: money(1600),
    images: [image('cards.svg', 'Placeholder artwork: two overlapping greeting cards')],
    categories: [cat('extras')],
    attributes: [],
    variations: [],
    optionSchema: {
      version: 1,
      fields: [
        {
          id: 'recipient',
          type: 'text',
          label: 'Recipient name',
          helpText: 'Optional. Printed on the envelope.',
          maxLength: 30,
        },
      ],
    },
    availability: { purchasable: true, stockStatus: 'instock', madeToOrder: true, leadTimeDays: 4 },
    seo: {
      title: 'Sample Card Set',
      description: 'Placeholder SEO description for the sample card set.',
      noindex: false,
    },
    updatedAt: UPDATED,
  },
  {
    id: 107,
    slug: 'sample-name-tag',
    type: 'variable',
    name: 'Sample Name Tag',
    descriptionHtml: PLACEHOLDER_DESCRIPTION,
    shortDescription: 'Placeholder: one price, colors chosen from dropdowns, name typed in.',
    price: money(899),
    images: [
      image('stickers.svg', 'Placeholder artwork: orange circle, blue square, and a triangle'),
    ],
    categories: [cat('extras')],
    attributes: [
      {
        slug: 'tag-color',
        name: 'Tag Color',
        usedForVariations: true,
        options: [
          { slug: 'black', name: 'Black' },
          { slug: 'red', name: 'Red' },
          { slug: 'blue', name: 'Blue' },
        ],
      },
      {
        slug: 'text-color',
        name: 'Text Color',
        usedForVariations: true,
        options: [
          { slug: 'white', name: 'White' },
          { slug: 'gray', name: 'Gray' },
        ],
      },
    ],
    // Same shape as a real WooCommerce catalog pattern: one variation, every attribute "Any" (empty string).
    variations: [
      {
        id: 1071,
        attributes: { 'tag-color': '', 'text-color': '' },
        price: money(899),
        stockStatus: 'instock',
      },
    ],
    optionSchema: {
      version: 1,
      fields: [
        {
          id: 'personalization',
          type: 'text',
          label: 'Name and icon',
          helpText: 'Example: Robin / Dog. Please double-check the spelling.',
          required: true,
          minLength: 1,
          maxLength: 40,
        },
      ],
    },
    availability: { purchasable: true, stockStatus: 'instock', madeToOrder: true, leadTimeDays: 4 },
    seo: {
      title: 'Sample Name Tag',
      description: 'Placeholder SEO description for the sample name tag.',
      noindex: false,
    },
    updatedAt: UPDATED,
  },
];

/** Parsed through the same schema that WooCommerce data must satisfy, so fixtures cannot drift from it. */
export const products: Product[] = rawProducts.map((p) => ProductSchema.parse(p));
