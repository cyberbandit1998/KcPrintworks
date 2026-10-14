/**
 * Renders HTML that has ALREADY been through sanitizeContent (lib/wp/sanitize.ts); the content layer returns nothing else.
 * Never pass it a string from anywhere else.
 */
export function ContentHtml({ html }: { html: string }) {
  return <div className="prose content" dangerouslySetInnerHTML={{ __html: html }} />;
}
