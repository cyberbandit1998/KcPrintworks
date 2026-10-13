'use client';

export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="container empty-state">
      <h1>Something went wrong</h1>
      <p>Please try again. If the problem continues, come back in a few minutes.</p>
      <button type="button" className="button" onClick={reset}>
        Try again
      </button>
    </div>
  );
}
