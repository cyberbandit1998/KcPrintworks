import { getContent, getContentConfig } from './wp';
import type { BlogTerm, PostPage } from './wp/types';

export type ArchiveKind = 'all' | 'category' | 'tag';

export type ArchiveResult =
  | { status: 'ok'; posts: PostPage; categories: BlogTerm[]; term?: BlogTerm }
  /** No such category or tag, or a page number past the last page: a real 404. */
  | { status: 'not-found' }
  /** WordPress could not be reached and nothing was kept from before. */
  | { status: 'unavailable' };

/**
 * One page of the blog, for the index and for a category or tag. Categories for the filter row are a nicety: when they cannot
 * be loaded the posts are still shown.
 */
export async function loadArchive(options: {
  kind: ArchiveKind;
  slug?: string;
  page: number;
}): Promise<ArchiveResult> {
  const content = getContent();
  const perPage = getContentConfig().postsPerPage;
  try {
    const categories = await content.listCategories().catch(() => [] as BlogTerm[]);
    let term: BlogTerm | undefined;
    if (options.kind !== 'all') {
      const terms = options.kind === 'category' ? categories : await content.listTags();
      term = terms.find((t) => t.slug === options.slug);
      if (!term) return { status: 'not-found' };
    }
    const posts = await content.listPosts({
      page: options.page,
      perPage,
      categoryId: options.kind === 'category' ? term?.id : undefined,
      tagId: options.kind === 'tag' ? term?.id : undefined,
    });
    if (options.page > 1 && posts.posts.length === 0) return { status: 'not-found' };
    return { status: 'ok', posts, categories, term };
  } catch {
    return { status: 'unavailable' };
  }
}
