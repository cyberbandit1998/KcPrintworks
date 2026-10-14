export const HOSTILE_CONTENT: string;
export function createWpFixture(host: string): Record<string, unknown>;
export function answerWp(
  url: URL,
  wp: Record<string, unknown>,
): { status: number; body: unknown; headers: Record<string, string> };
export function createReviewsFixture(): Record<string, unknown>;
export function answerStoreReviews(
  url: URL,
  reviews: Record<string, unknown>,
): { status: number; body: unknown; headers: Record<string, string> };
