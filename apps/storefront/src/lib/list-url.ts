import { parsePage, parseSort, type SortKey } from './catalog/queries';

/** The listing address for a sort and page, leaving defaults out so the plain URL stays the canonical one. */
export function listHref(path: string, { sort, page }: { sort?: SortKey; page?: number }): string {
  const query = new URLSearchParams();
  if (sort && sort !== 'recommended') query.set('sort', sort);
  if (page && page > 1) query.set('page', String(page));
  const text = query.toString();
  return text ? `${path}?${text}` : path;
}

export type ListSearchParams = Record<string, string | string[] | undefined>;

export function readListParams(searchParams: ListSearchParams) {
  return { sort: parseSort(searchParams.sort), page: parsePage(searchParams.page) };
}
