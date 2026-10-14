import Link from 'next/link';

/**
 * Shown when WordPress cannot be reached and nothing was kept from an earlier visit. It is a plain, honest message (never an error
 * page), it leaves the rest of the shop working. Keeping it out of search results is done by each page's generateMetadata (it asks the same cache, so there is no second wait).
 */
export function ContentUnavailable({ what }: { what: string }) {
  return (
    <div className="container empty-state" role="status">
      <h1>{what} is unavailable right now</h1>
      <p>We could not load this page just now. Please try again in a few minutes.</p>
      <p>
        <Link href="/shop/">Shop all products</Link>
      </p>
    </div>
  );
}
