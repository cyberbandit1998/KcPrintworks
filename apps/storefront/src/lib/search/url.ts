/** Addresses for the search page and the custom quote page, built in one place so the search box, the results and the no-match message agree. */

export function searchHref(params: { q?: string; category?: string; page?: number } = {}): string {
  const query = new URLSearchParams();
  if (params.q) query.set('q', params.q);
  if (params.category) query.set('category', params.category);
  if (params.page && params.page > 1) query.set('page', String(params.page));
  const text = query.toString();
  return text ? `/search/?${text}` : '/search/';
}

/** The quote form, optionally with what the visitor was looking for already typed in (the form shows it and lets them change it). */
export function quoteHref(item?: string): string {
  const value = (item ?? '').trim().slice(0, 120);
  return value ? `/custom-orders/?item=${encodeURIComponent(value)}` : '/custom-orders/';
}
