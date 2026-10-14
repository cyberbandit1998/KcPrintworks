import { Breadcrumbs, type Crumb } from '../Breadcrumbs';
import { ContentUnavailable } from '../ContentUnavailable';
import { Pagination } from '../Pagination';
import type { ArchiveResult } from '@/lib/blog';
import { BlogCategoryNav } from './BlogTermNav';
import { PostGrid } from './PostCard';

/** The blog index and the category and tag pages share this layout. `path` is the page's own address, for the page links. */
export function BlogArchive({
  result,
  path,
  title,
  intro,
  crumbs,
  currentCategory,
}: {
  result: Exclude<ArchiveResult, { status: 'not-found' }>;
  path: string;
  title: string;
  intro?: string;
  crumbs: Crumb[];
  currentCategory?: string;
}) {
  if (result.status === 'unavailable') return <ContentUnavailable what="The blog" />;
  const { posts, categories } = result;
  return (
    <>
      <Breadcrumbs items={crumbs} />
      <div className="container">
        <div className="page-header">
          <h1>{title}</h1>
          {intro ? <p>{intro}</p> : null}
        </div>
        <BlogCategoryNav categories={categories} current={currentCategory} />
        {posts.posts.length === 0 ? (
          <p className="empty-state">There are no posts here yet. Please check back soon.</p>
        ) : (
          <>
            <PostGrid posts={posts.posts} />
            <Pagination path={path} page={posts.page} pages={posts.pages} />
          </>
        )}
      </div>
    </>
  );
}
