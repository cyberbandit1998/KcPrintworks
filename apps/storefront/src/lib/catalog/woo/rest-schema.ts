import { z } from 'zod';

/**
 * The parts of WooCommerce REST v3 responses the storefront reads. Parsing is lenient about extras and defaults missing
 * optional fields, but a product without an id, name, or type is rejected (and reported), never guessed at.
 */
const str = z.string().catch('');

export const WooImageSchema = z.object({ id: z.number().catch(0), src: str, name: str, alt: str });

export const WooCategoryRefSchema = z.object({
  id: z.number(),
  name: z.string(),
  slug: z.string(),
});

export const WooTagSchema = z.object({ id: z.number().catch(0), name: str, slug: z.string() });

export const WooAttributeSchema = z.object({
  id: z.number().catch(0),
  name: z.string(),
  visible: z.boolean().catch(true),
  variation: z.boolean().catch(false),
  options: z.array(z.string()).catch([]),
});

export const WooMetaSchema = z.object({ key: z.string(), value: z.unknown() });

export const WooProductSchema = z.object({
  id: z.number(),
  name: z.string(),
  slug: str,
  type: z.string(),
  status: str,
  catalog_visibility: z.string().catch('visible'),
  description: str,
  short_description: str,
  sku: str,
  price: str,
  regular_price: str,
  sale_price: str,
  on_sale: z.boolean().catch(false),
  stock_status: z.string().catch('instock'),
  categories: z.array(WooCategoryRefSchema).catch([]),
  tags: z.array(WooTagSchema).catch([]),
  images: z.array(WooImageSchema).catch([]),
  attributes: z.array(WooAttributeSchema).catch([]),
  variations: z.array(z.number()).catch([]),
  date_modified_gmt: str,
  meta_data: z.array(WooMetaSchema).catch([]),
  /** The Featured star in Products. */
  featured: z.boolean().catch(false),
  /** Publication date. Whichever of the two WooCommerce sends first is used; both are the product's created date. */
  date_created_gmt: str,
  date_created: str,
  menu_order: z.number().catch(0),
  average_rating: str,
  rating_count: z.number().catch(0),
  reviews_allowed: z.boolean().catch(false),
});
export type WooProduct = z.infer<typeof WooProductSchema>;

export const WooVariationSchema = z.object({
  id: z.number(),
  sku: str,
  status: str,
  price: str,
  regular_price: str,
  sale_price: str,
  on_sale: z.boolean().catch(false),
  stock_status: z.string().catch('instock'),
  attributes: z.array(z.object({ name: z.string(), option: str })).catch([]),
});
export type WooVariation = z.infer<typeof WooVariationSchema>;

export const WooCategorySchema = z.object({
  id: z.number(),
  name: z.string(),
  slug: z.string(),
  description: str,
  count: z.number().catch(0),
  /** Parent category id; 0 for a top-level category. */
  parent: z.number().catch(0),
  menu_order: z.number().catch(0),
  image: z.object({ src: str }).nullable().catch(null),
});
export type WooCategory = z.infer<typeof WooCategorySchema>;
