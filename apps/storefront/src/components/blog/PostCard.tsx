import Link from 'next/link';
import { formatDate } from '@/lib/format-date';
import type { BlogPostSummary } from '@/lib/wp/types';
import { ContentImage } from '../ContentImage';

export function PostCard({ post }: { post: BlogPostSummary }) {
  return (
    <article className="card post-card">
      {post.image ? (
        <div className="card__media">
          {/* The title link below names the card, so the picture is decorative here. */}
          <ContentImage image={post.image} alt="" sizes="(min-width: 48em) 33vw, 100vw" />
        </div>
      ) : null}
      <div className="card__body">
        <p className="post-card__meta">
          <time dateTime={post.publishedAt}>{formatDate(post.publishedAt)}</time>
          {post.categories[0] ? <span> · {post.categories[0].name}</span> : null}
        </p>
        <h3 className="card__title">
          <Link href={`/blog/${post.slug}/`}>{post.title}</Link>
        </h3>
        {post.excerpt ? <p className="post-card__excerpt">{post.excerpt}</p> : null}
      </div>
    </article>
  );
}

export function PostGrid({ posts }: { posts: readonly BlogPostSummary[] }) {
  return (
    <ul className="product-grid post-grid">
      {posts.map((post) => (
        <li key={post.id}>
          <PostCard post={post} />
        </li>
      ))}
    </ul>
  );
}
