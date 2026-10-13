import { describe, expect, it } from 'vitest';
import { sanitizeRichText } from '@/components/RichText';
import { jsonLdString, productJsonLd } from '@/lib/seo';
import { products } from '@/lib/catalog/fixtures';

describe('sanitizeRichText', () => {
  it('keeps simple formatting', () => {
    expect(sanitizeRichText('<p>Hi <strong>there</strong></p><ul><li>One</li></ul>')).toBe(
      '<p>Hi <strong>there</strong></p><ul><li>One</li></ul>',
    );
  });

  it('removes scripts, event handlers, styles, and javascript: links', () => {
    const dirty =
      '<p onclick="x()">a</p><script>alert(1)</script><img src=x onerror=alert(1)><a href="javascript:alert(1)">l</a><iframe src="https://e.com"></iframe><style>p{}</style>';
    const clean = sanitizeRichText(dirty);
    expect(clean).not.toMatch(/script|onclick|onerror|javascript:|iframe|<img|<style/i);
    expect(clean).toContain('<p>a</p>');
  });

  it('allows https links and adds rel', () => {
    expect(sanitizeRichText('<a href="https://example.com/x" target="_blank">x</a>')).toBe(
      '<a href="https://example.com/x" rel="noopener noreferrer">x</a>',
    );
  });
});

describe('JSON-LD', () => {
  it('escapes "<" so content cannot close the script tag', () => {
    const out = jsonLdString({ name: '</script><script>alert(1)</script>' });
    expect(out).not.toContain('</script>');
    expect(JSON.parse(out).name).toBe('</script><script>alert(1)</script>');
  });

  it('describes a variable product with an aggregate offer and a simple one with a single offer', () => {
    const poster = productJsonLd(products.find((p) => p.slug === 'sample-custom-poster')!);
    expect(poster.offers['@type']).toBe('AggregateOffer');
    const print = productJsonLd(products.find((p) => p.slug === 'sample-personalized-print')!);
    expect(print.offers['@type']).toBe('Offer');
    expect(print.offers).toMatchObject({ price: '24.00', priceCurrency: 'USD' });
  });

  it('reports out-of-stock products as OutOfStock', () => {
    const mug = productJsonLd(products.find((p) => p.slug === 'sample-mug')!);
    expect(mug.offers.availability).toBe('https://schema.org/OutOfStock');
  });
});
