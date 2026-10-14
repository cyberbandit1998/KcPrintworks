import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Breadcrumbs } from '@/components/Breadcrumbs';
import { ContentHtml } from '@/components/ContentHtml';
import { ContentImage } from '@/components/ContentImage';
import { ContentUnavailable } from '@/components/ContentUnavailable';
import { JsonLd } from '@/components/JsonLd';
import { PostGrid } from '@/components/blog/PostCard';
import { formatDate } from '@/lib/format-date';
import { articleJsonLd, breadcrumbJsonLd, trimDescription } from '@/lib/seo';
import { withTimeout } from '@/lib/with-timeout';
import { getContent } from '@/lib/wp';
import type { BlogPost } from '@/lib/wp/types';

type Props = { params: Promise<{ slug: string }> };

type Loaded = { post: BlogPost | null } | { unavailable: true };

async function load(slug: string): Promise<Loaded> {
  try {
    return { post: await getContent().getPost(slug) };
  } catch {
    return { unavailable: true };
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const loaded = await load(slug);
  if ('unavailable' in loaded || !loaded.post) {
    return { title: 'Blog', robots: { index: false, follow: true } };
  }
  const { post } = loaded;
  const description = trimDescription(post.excerpt);
  const path = `/blog/${post.slug}/`;
  return {
    title: post.title,
    description: description || undefined,
    alternates: { canonical: path },
    openGraph: {
      type: 'article',
      title: post.title,
      description: description || undefined,
      url: path,
      publishedTime: post.publishedAt,
      modifiedTime: post.modifiedAt,
      images: post.image
        ? [{ url: post.image.url, width: post.image.width, height: post.image.height }]
        : undefined,
    },
    twitter: { card: post.image ? 'summary_large_image' : 'summary' },
  };
}

export default async function BlogPostPage({ params }: Props) {
  const { slug } = await params;
  const loaded = await load(slug);
  if ('unavailable' in loaded) return <ContentUnavailable what="This post" />;
  const { post } = loaded;
  if (!post) notFound();

  // More posts is a nicety: a slow WordPress must not hold the article back.
  const more = await withTimeout(getContent().listPosts({ page: 1, perPage: 4 }), 2500, null);
  const others = (more?.posts ?? []).filter((p) => p.id !== post.id).slice(0, 3);

  return (
    <>
      <JsonLd
        data={articleJsonLd({
          title: post.title,
          description: trimDescription(post.excerpt),
          path: `/blog/${post.slug}/`,
          publishedAt: post.publishedAt,
          modifiedAt: post.modifiedAt,
          image: post.image?.url,
        })}
      />
      <JsonLd
        data={breadcrumbJsonLd([
          { name: 'Home', path: '/' },
          { name: 'Blog', path: '/blog/' },
          { name: post.title, path: `/blog/${post.slug}/` },
        ])}
      />
      <Breadcrumbs
        items={[
          { name: 'Home', href: '/' },
          { name: 'Blog', href: '/blog/' },
          { name: post.title },
        ]}
      />
      <article className="container post">
        <header className="post__header">
          <p className="post-card__meta">
            <time dateTime={post.publishedAt}>{formatDate(post.publishedAt)}</time>
            <span> · {post.readingMinutes} min read</span>
          </p>
          <h1>{post.title}</h1>
          {post.categories.length > 0 ? (
            <ul className="chips" aria-label="Categories">
              {post.categories.map((category) => (
                <li key={category.slug}>
                  <Link className="chip" href={`/blog/category/${category.slug}/`}>
                    {category.name}
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </header>
        {post.image ? (
          <figure className="post__image">
            <ContentImage image={post.image} sizes="(min-width: 60em) 60rem, 100vw" priority />
          </figure>
        ) : null}
        <ContentHtml html={post.html} />
        {post.tags.length > 0 ? (
          <nav className="post__tags" aria-label="Tags">
            <ul className="chips">
              {post.tags.map((tag) => (
                <li key={tag.slug}>
                  <Link className="chip" href={`/blog/tag/${tag.slug}/`}>
                    {tag.name}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
      </article>
      {others.length > 0 ? (
        <section className="section" aria-labelledby="more-posts-heading">
          <div className="container">
            <div className="section__header">
              <h2 id="more-posts-heading">More from the blog</h2>
              <Link href="/blog/">All posts</Link>
            </div>
            <PostGrid posts={others} />
          </div>
        </section>
      ) : null}
    </>
  );
}
