import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="container empty-state">
      <h1>Page not found</h1>
      <p>The page you are looking for does not exist or has moved.</p>
      <Link href="/shop/" className="button">
        Shop all products
      </Link>
    </div>
  );
}
