import { z } from 'zod';

/**
 * The parts of the WordPress REST API (wp/v2) that are used. This is data from outside, so it is NOT strict: WordPress and its
 * plugins add fields freely, and an unknown one must never break the blog. A row that lacks something required is skipped.
 */
const Rendered = z.object({ rendered: z.string(), protected: z.boolean().optional() });

const WpTerm = z.object({
  id: z.number().int(),
  name: z.string(),
  slug: z.string(),
  taxonomy: z.string().optional(),
  count: z.number().int().optional(),
});
export type WpTermRow = z.infer<typeof WpTerm>;

const WpMedia = z.object({
  source_url: z.string(),
  alt_text: z.string().optional(),
  media_type: z.string().optional(),
  media_details: z
    .object({ width: z.number().optional(), height: z.number().optional() })
    .passthrough()
    .optional(),
});
export type WpMediaRow = z.infer<typeof WpMedia>;

export const WpPostSchema = z.object({
  id: z.number().int(),
  slug: z.string().min(1),
  status: z.string().optional(),
  type: z.string().optional(),
  date_gmt: z.string().nullish(),
  modified_gmt: z.string().nullish(),
  link: z.string().optional(),
  title: Rendered,
  excerpt: Rendered.optional(),
  content: Rendered.optional(),
  categories: z.array(z.number().int()).optional(),
  tags: z.array(z.number().int()).optional(),
  featured_media: z.number().int().optional(),
  _embedded: z
    .object({
      'wp:featuredmedia': z.array(z.unknown()).optional(),
      'wp:term': z.array(z.array(z.unknown())).optional(),
    })
    .passthrough()
    .optional(),
});
export type WpPostRow = z.infer<typeof WpPostSchema>;

export const WpTermSchema = WpTerm;

/** Only meaningful when the embedded media row is a real media object (a missing one is an error object, which fails here). */
export function parseMedia(value: unknown): WpMediaRow | undefined {
  const parsed = WpMedia.safeParse(value);
  return parsed.success && (parsed.data.media_type ?? 'image') === 'image'
    ? parsed.data
    : undefined;
}

export function parseTerm(value: unknown): WpTermRow | undefined {
  const parsed = WpTerm.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}
