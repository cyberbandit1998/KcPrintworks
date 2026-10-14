import { describe, expect, it } from 'vitest';
import { starFills, ratingWords } from '@/components/Stars';
import { reviewParagraphs, shortAuthor, toReview } from '@/lib/reviews/convert';
import { createFixtureReviewsClient } from '@/lib/reviews/fixture-client';
import { homeMinRating } from '@/lib/reviews';
import { createReviewsSource } from '@/lib/reviews/source';
import { productJsonLd } from '@/lib/seo';
import { products } from '@/lib/catalog/fixtures';
import { WpError, type WpClient } from '@/lib/wp/client';
import { answerStoreReviews, createReviewsFixture } from '../support/wp-fixture.mjs';

describe('author names', () => {
  it('shows a first name and the initial of the last name', () => {
    expect(shortAuthor('Jane Doe')).toBe('Jane D.');
    expect(shortAuthor('  mary   ann   smith ')).toBe('mary S.');
    expect(shortAuthor('Jane')).toBe('Jane');
    expect(shortAuthor('Élodie Ōta')).toBe('Élodie Ō.');
  });

  it('never publishes an email address or a login name that looks like one', () => {
    for (const raw of [
      'bob@example.com',
      'Bob Smith bob@example.com',
      null,
      undefined,
      '',
      '   ',
    ]) {
      expect(shortAuthor(raw as string | null), String(raw)).toBe('Customer');
    }
  });

  it('removes markup from a name', () => {
    expect(shortAuthor('<b>Jane</b> <script>x</script>Doe')).toBe('Jane D.');
    expect(shortAuthor('Tom &amp; Jerry')).toBe('Tom J.');
  });
});

describe('review text', () => {
  it('keeps paragraphs and line breaks as plain text and removes every tag', () => {
    expect(
      reviewParagraphs('<p>Great case!<br />Fits &amp; looks solid.</p><p>Second</p>'),
    ).toEqual(['Great case!', 'Fits & looks solid.', 'Second']);
    expect(
      reviewParagraphs('<p>Hi<script>alert(1)</script><img src=x onerror=alert(1)></p>'),
    ).toEqual(['Hi']);
  });

  it('shows markup typed as text as text, never as markup', () => {
    expect(reviewParagraphs('&lt;b&gt;bold&lt;/b&gt;')).toEqual(['<b>bold</b>']); // React escapes it when drawn
  });
});

describe('which rows count as reviews', () => {
  const base = {
    id: 1,
    product_id: 5,
    product_name: 'Mug',
    reviewer: 'Jane Doe',
    review: '<p>Nice</p>',
    rating: 5,
    date_created_gmt: '2026-10-01T10:00:00',
    verified: false,
  };
  it('accepts a whole rating from 1 to 5 with text and a date', () => {
    expect(toReview(base)).toMatchObject({
      rating: 5,
      author: 'Jane D.',
      verified: false,
      publishedAt: '2026-10-01T10:00:00.000Z',
    });
  });
  it('shows "verified" only when WooCommerce says so', () => {
    expect(toReview({ ...base, verified: true })?.verified).toBe(true);
    expect(toReview({ ...base, verified: undefined })?.verified).toBe(false);
  });
  it('leaves out rows without a real rating, without text, or without a date', () => {
    for (const bad of [
      { rating: 0 },
      { rating: 6 },
      { rating: 4.5 },
      { rating: null },
      { review: '<p> </p>' },
      { review: null },
      { date_created_gmt: null, date_created: null },
    ]) {
      expect(toReview({ ...base, ...bad } as never), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe('stars', () => {
  it('rounds to the nearest half star', () => {
    expect(starFills(4.5)).toEqual(['full', 'full', 'full', 'full', 'half']);
    expect(starFills(4.2)).toEqual(['full', 'full', 'full', 'full', 'empty']);
    expect(starFills(4.3)).toEqual(['full', 'full', 'full', 'full', 'half']);
    expect(starFills(5)).toEqual(['full', 'full', 'full', 'full', 'full']);
    expect(starFills(1)).toEqual(['full', 'empty', 'empty', 'empty', 'empty']);
    expect(starFills(0)).toEqual(['empty', 'empty', 'empty', 'empty', 'empty']);
  });
  it('says the rating in words', () => {
    expect(ratingWords(4.5)).toBe('4.5 out of 5 stars');
    expect(ratingWords(5)).toBe('5 out of 5 stars');
  });
});

describe('the reviews source', () => {
  function storeClient() {
    const reviews = createReviewsFixture();
    const calls: string[] = [];
    const client: WpClient = {
      async get(path, params = {}) {
        const url = new URL(`https://shop.test/wp-json/wc/store/v1${path}`);
        for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
        calls.push(url.search);
        const answer = answerStoreReviews(url, reviews);
        if (answer.status >= 400) throw new WpError(`HTTP ${answer.status}`, answer.status);
        return {
          data: answer.body,
          total: Number(answer.headers['x-wp-total']),
          totalPages: Number(answer.headers['x-wp-totalpages']),
        };
      },
    };
    return { reviews, calls, client };
  }

  it('lists a product’s approved reviews with ratings only, names shortened, newest first', async () => {
    const { client } = storeClient();
    const source = createReviewsSource({ client, ttlSeconds: 60, register: false });
    const page = await source.forProduct(201, 1, 10);
    expect(page.reviews.map((r) => [r.id, r.author, r.rating, r.verified])).toEqual([
      [501, 'Alice S.', 5, true],
      [502, 'Customer', 4, false],
    ]); // 503 has no rating and is a reply
    expect(page.reviews[0]!.paragraphs).toEqual(['Great case!', 'Fits & looks solid.']);
    expect(JSON.stringify(page)).not.toMatch(/bob@|gravatar|pwned|script/);
  });

  it('lists the newest across the shop, filtered by the lowest rating, from one request', async () => {
    const { client, calls } = storeClient();
    const source = createReviewsSource({ client, ttlSeconds: 60, register: false });
    expect((await source.latest(5)).map((r) => r.id)).toEqual([504, 501, 502]);
    expect((await source.latest(5, 5)).map((r) => r.id)).toEqual([504, 501]);
    expect((await source.latest(1)).map((r) => r.id)).toEqual([504]);
    expect(calls).toHaveLength(1);
  });

  it('answers 400 for a page past the end with an empty page', async () => {
    const { client } = storeClient();
    const source = createReviewsSource({ client, ttlSeconds: 60, register: false });
    expect(await source.forProduct(201, 9, 10)).toMatchObject({ reviews: [], pages: 0 });
  });

  it('keeps the last good copy when WooCommerce stops answering', async () => {
    const { client, reviews } = storeClient();
    let clock = 1_000;
    const source = createReviewsSource({
      client,
      ttlSeconds: 60,
      register: false,
      now: () => clock,
    });
    expect((await source.forProduct(201, 1, 10)).reviews).toHaveLength(2);
    reviews.failing = true;
    clock += 61_000;
    expect((await source.forProduct(201, 1, 10)).reviews).toHaveLength(2);
    await new Promise((r) => setTimeout(r, 0));
    expect((await source.forProduct(201, 1, 10)).reviews).toHaveLength(2);
  });

  it('the sample reviews match the sample products’ ratings exactly', async () => {
    const source = createReviewsSource({
      client: createFixtureReviewsClient(),
      ttlSeconds: 60,
      register: false,
    });
    for (const product of products.filter((p) => p.rating)) {
      const page = await source.forProduct(product.id, 1, 50);
      const average = page.reviews.reduce((sum, r) => sum + r.rating, 0) / page.reviews.length;
      expect(page.reviews.length, product.slug).toBe(product.rating!.count);
      expect(average, product.slug).toBeCloseTo(product.rating!.average, 5);
    }
  });
});

describe('home page review settings', () => {
  it('takes the lowest rating from the environment, ignoring nonsense', () => {
    expect(homeMinRating({})).toBe(1);
    expect(homeMinRating({ HOME_REVIEWS_MIN_RATING: '4' })).toBe(4);
    for (const bad of ['0', '6', '4.5', 'abc', ''])
      expect(homeMinRating({ HOME_REVIEWS_MIN_RATING: bad })).toBe(1);
  });
});

describe('Product JSON-LD with ratings', () => {
  const rated = products.find((p) => p.slug === 'sample-card-set')!;
  const unrated = products.find((p) => p.slug === 'sample-mug')!;
  const review = {
    id: 1,
    productId: rated.id,
    productName: rated.name,
    author: 'Jane D.',
    rating: 4,
    paragraphs: ['Good.', 'Second paragraph.'],
    publishedAt: '2026-10-01T10:00:00.000Z',
    verified: true,
  };

  it('adds WooCommerce’s own average and count, and the shown reviews, when there are some', () => {
    const ld = productJsonLd(rated, [review]) as Record<string, unknown>;
    expect(ld.aggregateRating).toEqual({
      '@type': 'AggregateRating',
      ratingValue: 4.5,
      reviewCount: 4,
      bestRating: 5,
      worstRating: 1,
    });
    expect(ld.review).toEqual([
      {
        '@type': 'Review',
        author: { '@type': 'Person', name: 'Jane D.' },
        datePublished: '2026-10-01T10:00:00.000Z',
        reviewBody: 'Good.\n\nSecond paragraph.',
        reviewRating: { '@type': 'Rating', ratingValue: 4, bestRating: 5, worstRating: 1 },
      },
    ]);
  });

  it('adds nothing when the product has no ratings, even if reviews were passed', () => {
    const ld = productJsonLd(unrated, [review]) as Record<string, unknown>;
    expect('aggregateRating' in ld).toBe(false);
    expect('review' in ld).toBe(false);
  });

  it('adds the average but no review entries when the reviews could not be loaded', () => {
    const ld = productJsonLd(rated, []) as Record<string, unknown>;
    expect(ld.aggregateRating).toBeTruthy();
    expect('review' in ld).toBe(false);
  });
});
