import { z } from 'zod';
import { MoneySchema } from './money';
import { OptionSchemaSchema } from './options';

/**
 * Storefront product DTO: what `kcpw-core` serves at /wp-json/kcpw/v1/products (ADR-008).
 *
 * Excluded by construction: cost, Etsy IDs and Etsy prices, internal notes, customer data.
 * `.strict()` makes a stray field a validation error instead of a silent leak.
 */

export const StockStatusSchema = z.enum(['instock', 'outofstock', 'onbackorder']);
export type StockStatus = z.infer<typeof StockStatusSchema>;

export const ImageSchema = z
  .object({
    id: z.number().int(),
    url: z.string().min(1),
    alt: z.string(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  })
  .strict();
export type ProductImage = z.infer<typeof ImageSchema>;

export const CategoryRefSchema = z
  .object({ id: z.number().int(), slug: z.string().min(1), name: z.string().min(1) })
  .strict();
export type CategoryRef = z.infer<typeof CategoryRefSchema>;

export const AttributeSchema = z
  .object({
    slug: z.string().min(1),
    name: z.string().min(1),
    /** True when this attribute selects between variations. */
    usedForVariations: z.boolean(),
    options: z
      .array(z.object({ slug: z.string().min(1), name: z.string().min(1) }).strict())
      .min(1),
  })
  .strict();
export type ProductAttribute = z.infer<typeof AttributeSchema>;

export const VariationSchema = z
  .object({
    id: z.number().int(),
    sku: z.string().optional(),
    /**
     * attribute slug -> option slug. Every variation lists every variation attribute. An EMPTY string means
     * "Any" (WooCommerce semantics): the variation matches whatever option the shopper chooses for it.
     */
    attributes: z.record(z.string(), z.string()),
    price: MoneySchema,
    regularPrice: MoneySchema.optional(),
    stockStatus: StockStatusSchema,
    /** Present only when WooCommerce manages stock for this variation. */
    stockQuantity: z.number().int().nonnegative().optional(),
    image: ImageSchema.optional(),
  })
  .strict();
export type Variation = z.infer<typeof VariationSchema>;

export const AvailabilitySchema = z
  .object({
    purchasable: z.boolean(),
    stockStatus: StockStatusSchema,
    stockQuantity: z.number().int().nonnegative().optional(),
    /** Made to order: no stock limit applies; `leadTimeDays` is shown instead. */
    madeToOrder: z.boolean(),
    leadTimeDays: z.number().int().positive().optional(),
  })
  .strict();

export const SeoSchema = z
  .object({
    title: z.string().min(1),
    description: z.string().min(1),
    canonicalPath: z.string().startsWith('/').optional(),
    noindex: z.boolean().default(false),
  })
  .strict();

export const ProductSchema = z
  .object({
    id: z.number().int(),
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    type: z.enum(['simple', 'variable']),
    name: z.string().min(1),
    /** HTML from WooCommerce. MUST be sanitized before rendering (see RichText). */
    descriptionHtml: z.string(),
    shortDescription: z.string(),
    sku: z.string().optional(),
    /** Current effective price (sale price when on sale). For variable products, the lowest variation price. */
    price: MoneySchema,
    regularPrice: MoneySchema.optional(),
    images: z.array(ImageSchema),
    categories: z.array(CategoryRefSchema),
    attributes: z.array(AttributeSchema),
    variations: z.array(VariationSchema),
    optionSchema: OptionSchemaSchema,
    availability: AvailabilitySchema,
    seo: SeoSchema,
    updatedAt: z.string(),
  })
  .strict()
  .superRefine((product, ctx) => {
    if (product.type === 'simple' && product.variations.length > 0) {
      ctx.addIssue({ code: 'custom', message: 'Simple products cannot have variations' });
    }
    if (product.type === 'variable') {
      if (product.variations.length === 0) {
        ctx.addIssue({ code: 'custom', message: 'Variable products need at least one variation' });
      }
      const variationAttrs = product.attributes.filter((a) => a.usedForVariations);
      for (const variation of product.variations) {
        for (const attr of variationAttrs) {
          const chosen = variation.attributes[attr.slug];
          const valid = chosen === '' || attr.options.some((o) => o.slug === chosen);
          if (chosen === undefined || !valid) {
            ctx.addIssue({
              code: 'custom',
              message: `Variation ${variation.id} has an invalid or missing "${attr.slug}"`,
            });
          }
        }
      }
    }
  });
export type Product = z.infer<typeof ProductSchema>;

/** Lightweight shape for listings. */
export type ProductSummary = Pick<
  Product,
  | 'id'
  | 'slug'
  | 'type'
  | 'name'
  | 'shortDescription'
  | 'price'
  | 'regularPrice'
  | 'images'
  | 'categories'
  | 'availability'
> & { personalizable: boolean };

export function toSummary(product: Product): ProductSummary {
  return {
    id: product.id,
    slug: product.slug,
    type: product.type,
    name: product.name,
    shortDescription: product.shortDescription,
    price: product.price,
    regularPrice: product.regularPrice,
    images: product.images,
    categories: product.categories,
    availability: product.availability,
    personalizable: product.optionSchema.fields.length > 0,
  };
}

export const CategorySchema = z
  .object({
    id: z.number().int(),
    slug: z.string().min(1),
    name: z.string().min(1),
    description: z.string(),
    seo: SeoSchema,
  })
  .strict();
export type Category = z.infer<typeof CategorySchema>;
