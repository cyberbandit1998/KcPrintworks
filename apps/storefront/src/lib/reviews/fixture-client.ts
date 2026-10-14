import { WpError, type WpClient, type WpResult } from '../wp/client';

/**
 * SYNTHETIC reviews for the design preview and tests. They are shaped like WooCommerce Store API rows and are marked as sample text;
 * none was written by a customer. The counts and averages match the sample products in lib/catalog/fixtures.ts (card set 4.5 from 4,
 * sticker pack 5.0 from 1).
 */
type Row = Record<string, unknown>;

function review(
  id: number,
  productId: number,
  productName: string,
  reviewer: string,
  rating: number,
  day: string,
  text: string,
  verified: boolean,
): Row {
  return {
    id,
    date_created_gmt: `${day}T15:00:00`,
    product_id: productId,
    product_name: productName,
    reviewer,
    review: `<p>${text}</p>`,
    rating,
    verified,
  };
}

const NOTE = 'Sample review text for the design preview.';

const rows: Row[] = [
  review(
    1,
    106,
    'Sample Card Set',
    'Sample Customer A',
    5,
    '2026-10-12',
    `${NOTE} Five stars.`,
    true,
  ),
  review(
    2,
    106,
    'Sample Card Set',
    'Sample Customer B',
    4,
    '2026-10-08',
    `${NOTE} Four stars.`,
    false,
  ),
  review(
    3,
    103,
    'Sample Sticker Pack',
    'Sample Customer C',
    5,
    '2026-10-06',
    `${NOTE} A single review.`,
    true,
  ),
  review(
    4,
    106,
    'Sample Card Set',
    'Sample Customer D',
    5,
    '2026-10-03',
    `${NOTE} Another five stars.`,
    false,
  ),
  review(
    5,
    106,
    'Sample Card Set',
    'Sample Customer E',
    4,
    '2026-09-28',
    `${NOTE} Another four.`,
    true,
  ),
];

export function createFixtureReviewsClient(): WpClient {
  async function get(
    path: string,
    params: Record<string, string | number> = {},
  ): Promise<WpResult> {
    if (path !== '/products/reviews')
      return { data: { code: 'rest_no_route' }, total: 0, totalPages: 1 };
    const perPage = Math.min(100, Number(params.per_page ?? 10));
    const page = Number(params.page ?? 1);
    let list = [...rows].sort((a, b) =>
      String(b.date_created_gmt).localeCompare(String(a.date_created_gmt)),
    );
    if (params.product_id !== undefined)
      list = list.filter((r) => String(r.product_id) === String(params.product_id));
    const totalPages = Math.max(1, Math.ceil(list.length / perPage));
    if (page > totalPages && list.length > 0) throw new WpError('rest_invalid_page_number', 400);
    return {
      data: list.slice((page - 1) * perPage, page * perPage),
      total: list.length,
      totalPages,
    };
  }
  return { get };
}
