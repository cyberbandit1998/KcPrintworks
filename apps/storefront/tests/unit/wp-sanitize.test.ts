import { describe, expect, it } from 'vitest';
import {
  decodeEntities,
  plainText,
  rewriteHref,
  safeEmbedSrc,
  sanitizeContent,
  type SanitizeContext,
} from '@/lib/wp/sanitize';
import { HOSTILE_CONTENT } from '../support/wp-fixture.mjs';

const WP = 'https://shop.example.com';
const ctx: SanitizeContext = {
  wpOrigin: WP,
  siteOrigin: 'https://www.example.com',
  links: {
    paths: new Map([
      ['/second-post/', '/blog/second-post/'],
      ['/our-story/', '/our-story/'],
    ]),
  },
};
const clean = (html: string, c = ctx) => sanitizeContent(html, c);

describe('sanitizeContent: what must never reach a page', () => {
  const out = clean(HOSTILE_CONTENT.replaceAll('__HOST__', WP));

  it('removes scripts, event handlers, inline styles, forms, svg, and unknown frames', () => {
    for (const bad of [
      '<script',
      'pwned',
      'onerror',
      'onload',
      'javascript:',
      'style=',
      '<form',
      '<input',
      '<button',
      '<svg',
      'evil.example',
      'data-x',
    ]) {
      expect(out.includes(bad), `${bad} should be gone`).toBe(false);
    }
  });

  it('keeps ordinary text and formatting', () => {
    expect(out).toContain('<strong>bold</strong>');
    expect(out).toContain('Safe paragraph');
  });

  it('turns the content h1 into an h2 and does not let a heading take the page id', () => {
    expect(out).not.toContain('<h1');
    expect(out).toContain('<h2');
    expect(out).not.toContain('id="main"');
    expect(out).toContain('id="c-main"');
  });

  it('drops classes that are not WordPress block classes', () => {
    expect(out).not.toContain('class="button"');
    expect(out).toContain('class="wp-block-embed"');
  });

  it('allows a YouTube embed, through the privacy-enhanced domain, sandboxed', () => {
    expect(out).toContain('src="https://www.youtube-nocookie.com/embed/aqz-KE-bpKQ"');
    expect(out).toContain('sandbox="');
    expect(out).toContain('loading="lazy"');
    expect(out).not.toContain('feature=oembed');
  });

  it('makes images lazy with an alt and removes ones without a safe source', () => {
    expect(out).toContain('src="https://images.example/x.png"');
    expect(out).toContain('alt="A picture"');
    expect(out).toContain('loading="lazy"');
    expect(clean('<img src="javascript:alert(1)" alt="x">')).toBe('');
    expect(clean('<img src="data:image/png;base64,AAAA" alt="x">')).toBe('');
    expect(clean('<img src="http://tracker.example/p.gif" alt="">')).toBe('');
  });

  it('removes only-text tags with their contents (script, style, textarea, noscript)', () => {
    expect(
      clean('<p>a</p><style>p{color:red}</style><noscript>n</noscript><textarea>t</textarea>'),
    ).toBe('<p>a</p>');
  });
});

describe('links', () => {
  it('rewrites links to a known post, and Our Story, to the storefront', () => {
    expect(rewriteHref(`${WP}/second-post/`, ctx)).toBe('/blog/second-post/');
    expect(rewriteHref(`${WP}/our-story/#x`, ctx)).toBe('/our-story/#x');
    expect(rewriteHref(`${WP}/second-post`, ctx)).toBe('/blog/second-post/');
  });

  it('keeps shop paths that exist in the storefront, and leaves the rest pointing at the shop', () => {
    expect(rewriteHref(`${WP}/product/mug/`, ctx)).toBe('/product/mug/');
    expect(rewriteHref(`${WP}/product-category/gifts/?x=1`, ctx)).toBe(
      '/product-category/gifts/?x=1',
    );
    expect(rewriteHref(`${WP}/checkout/`, ctx)).toBe(`${WP}/checkout/`);
    expect(rewriteHref(`${WP}/some-page/`, ctx)).toBe(`${WP}/some-page/`);
  });

  it('makes links to the storefront relative', () => {
    expect(rewriteHref('https://www.example.com/shop/', ctx)).toBe('/shop/');
  });

  it('allows https, mailto, and tel; refuses everything else, including plain http elsewhere', () => {
    expect(rewriteHref('https://example.org/a', ctx)).toBe('https://example.org/a');
    expect(rewriteHref('mailto:hi@example.org', ctx)).toBe('mailto:hi@example.org');
    expect(rewriteHref('tel:+15555550100', ctx)).toBe('tel:+15555550100');
    for (const bad of [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      ' javascript:alert(1)',
      'data:text/html,<script>1</script>',
      'vbscript:x',
      'http://example.org/a',
      'ftp://example.org/a',
      '',
    ]) {
      expect(rewriteHref(bad, ctx), bad).toBeNull();
    }
  });

  it('prefixes in-page anchors the same way headings are prefixed', () => {
    expect(rewriteHref('#section-2', ctx)).toBe('#c-section-2');
    expect(rewriteHref('#bad id', ctx)).toBeNull();
  });

  it('adds rel to every link and never opens a new window', () => {
    const out = clean('<a href="https://example.org/a" target="_blank" onclick="x()">x</a>');
    expect(out).toBe('<a rel="noopener noreferrer" href="https://example.org/a">x</a>');
  });

  it('leaves the words of a link with a refused address', () => {
    expect(clean('<a href="javascript:alert(1)">words</a>')).toBe(
      '<a rel="noopener noreferrer">words</a>',
    );
  });
});

describe('embeds', () => {
  it('accepts only YouTube and Vimeo player addresses', () => {
    expect(safeEmbedSrc('https://www.youtube.com/embed/abc_DEF-123')).toBe(
      'https://www.youtube-nocookie.com/embed/abc_DEF-123',
    );
    expect(safeEmbedSrc('https://www.youtube-nocookie.com/embed/abc?start=30&autoplay=1')).toBe(
      'https://www.youtube-nocookie.com/embed/abc?start=30',
    );
    expect(safeEmbedSrc('https://player.vimeo.com/video/123456')).toBe(
      'https://player.vimeo.com/video/123456?dnt=1',
    );
    // A protocol-relative address to an allowed host is rewritten to the explicit https one, never passed through.
    expect(safeEmbedSrc('//www.youtube.com/embed/abc')).toBe(
      'https://www.youtube-nocookie.com/embed/abc',
    );
    for (const bad of [
      'https://evil.example/embed/abc',
      'https://www.youtube.com.evil.example/embed/abc',
      'https://www.youtube.com/watch?v=abc',
      'https://www.youtube.com/embed/../../x',
      'http://www.youtube.com/embed/abc',
      'javascript:alert(1)',
      '//evil.example/embed/abc',
      undefined,
    ]) {
      expect(safeEmbedSrc(bad), String(bad)).toBeNull();
    }
  });

  it('removes a frame whose address is not allowed, leaving no empty box', () => {
    expect(clean('<p>a</p><iframe src="https://evil.example/x"></iframe>')).toBe('<p>a</p>');
    expect(clean('<iframe srcdoc="<script>1</script>"></iframe>')).toBe('');
  });
});

describe('text helpers', () => {
  it('decodes the entities WordPress writes and leaves unknown ones alone', () => {
    expect(decodeEntities('Tom &amp; Jerry&#8217;s &#x2013; &hellip; &madeup; &#0; &#xD800;')).toBe(
      'Tom & Jerry’s – … &madeup; &#0; &#xD800;',
    );
  });

  it('plainText strips markup, decodes, and collapses whitespace', () => {
    expect(plainText('<p>Hello&nbsp;<em>there</em> &#8211;\n  you</p><script>x</script>')).toBe(
      'Hello there – you',
    );
  });

  it('plainText never lets decoded text become markup', () => {
    // The result is rendered by React as TEXT; the point is that tags are removed BEFORE decoding.
    expect(plainText('&lt;script&gt;alert(1)&lt;/script&gt;')).toBe('<script>alert(1)</script>');
    expect(plainText('<script>alert(1)</script>ok')).toBe('ok');
  });
});
