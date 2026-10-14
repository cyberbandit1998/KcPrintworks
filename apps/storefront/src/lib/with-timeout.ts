/**
 * Waits for `promise` at most `ms`, then gives up and resolves to `fallback` (also when it rejects). For page sections that
 * are a nicety (latest posts, Our Story teaser): a slow or failing WordPress must never hold the whole page back.
 * The underlying request keeps running and still fills the cache for the next visitor.
 */
export function withTimeout<T, F>(promise: Promise<T>, ms: number, fallback: F): Promise<T | F> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<F>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([promise.catch(() => fallback), limit]).finally(() => clearTimeout(timer));
}
