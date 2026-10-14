import Link from 'next/link';
import type { BlogPostSummary } from '@/lib/wp/types';
import { PostGrid } from '../blog/PostCard';

/** The newest blog posts. Left out when there are none (or WordPress could not be reached in time). */
export function LatestPostsSection({ posts }: { posts: readonly BlogPostSummary[] }) {
  if (posts.length === 0) return null;
  return (
    <section className="section" aria-labelledby="latest-posts-heading" data-section="latest-posts">
      <div className="container">
        <div className="section__header">
          <h2 id="latest-posts-heading">Latest from the blog</h2>
          <Link href="/blog/">Read the blog</Link>
        </div>
        <PostGrid posts={posts} />
      </div>
    </section>
  );
}
