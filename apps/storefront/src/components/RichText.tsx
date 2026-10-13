import sanitizeHtml from 'sanitize-html';

/**
 * Renders HTML that originates in WooCommerce. It is sanitized here, on the server, with a small allowlist,
 * so a compromised or careless editor account cannot inject script into the storefront.
 */
const options: sanitizeHtml.IOptions = {
  allowedTags: [
    'p',
    'br',
    'strong',
    'b',
    'em',
    'i',
    'u',
    'ul',
    'ol',
    'li',
    'h3',
    'h4',
    'blockquote',
    'a',
  ],
  allowedAttributes: { a: ['href', 'title', 'rel'] },
  allowedSchemes: ['https', 'mailto'],
  allowedSchemesAppliedToAttributes: ['href'],
  allowProtocolRelative: false,
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer' }),
  },
};

export function sanitizeRichText(html: string): string {
  return sanitizeHtml(html, options);
}

export function RichText({ html }: { html: string }) {
  return <div className="prose" dangerouslySetInnerHTML={{ __html: sanitizeRichText(html) }} />;
}
