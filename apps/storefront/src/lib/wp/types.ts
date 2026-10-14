/**
 * What the storefront knows about WordPress content, independent of how WordPress sends it. Every string here is plain text
 * except `html`, which has already been through the sanitizer (lib/wp/sanitize.ts).
 */
export interface BlogTerm {
  id: number;
  name: string;
  slug: string;
  /** Published posts in this term, when WordPress said (0 otherwise). */
  count: number;
}

export interface ContentImage {
  url: string;
  width: number;
  height: number;
  /** Empty when the editor wrote no alt text: the picture is then treated as decorative. */
  alt: string;
}

export interface BlogPostSummary {
  id: number;
  slug: string;
  title: string;
  /** Plain text, trimmed to a few lines by the page that shows it. */
  excerpt: string;
  publishedAt: string;
  modifiedAt: string;
  image?: ContentImage;
  categories: BlogTerm[];
}

export interface BlogPost extends BlogPostSummary {
  /** Sanitized HTML. */
  html: string;
  tags: BlogTerm[];
  readingMinutes: number;
}

export interface PostPage {
  posts: BlogPostSummary[];
  total: number;
  pages: number;
  page: number;
}

export interface ContentPage {
  id: number;
  slug: string;
  title: string;
  /** Sanitized HTML. */
  html: string;
  excerpt: string;
  modifiedAt: string;
  image?: ContentImage;
}

export interface PostQuery {
  page: number;
  perPage: number;
  categoryId?: number;
  tagId?: number;
}

/** Everything the pages need from WordPress. Reads only. Methods reject when WordPress cannot be reached and nothing is cached. */
export interface ContentSource {
  listPosts(query: PostQuery): Promise<PostPage>;
  /** Null when no published post has this slug. */
  getPost(slug: string): Promise<BlogPost | null>;
  /** Null when no published page has this slug. */
  getPage(slug: string): Promise<ContentPage | null>;
  /** Categories and tags that have at least one published post. */
  listCategories(): Promise<BlogTerm[]>;
  listTags(): Promise<BlogTerm[]>;
  /** Every published post's address data, for the sitemap. */
  listPostIndex(): Promise<{ slug: string; modifiedAt: string }[]>;
}
