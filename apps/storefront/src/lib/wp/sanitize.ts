import sanitizeHtml from 'sanitize-html';

/**
 * Turns the HTML WordPress produces for a post or page into HTML that is safe to put in a storefront page.
 *
 * WordPress content is written by whoever can log in to it, and it passes through plugins, so it is treated as untrusted here:
 *  - a small allowlist of tags and attributes; no script, style, form, object, svg, inline style, event handler, or data: URL;
 *  - links: https, mailto and tel only; links to the shop's own WordPress that have a counterpart in the storefront
 *    (posts, Our Story, Contact, products, categories) point at the storefront instead; other links to the shop stay as they are;
 *  - images: https (or the shop's own address when that is a local test address), lazy loaded, with their sizes kept;
 *  - embeds: only YouTube (through its privacy-enhanced domain) and Vimeo, in a sandboxed frame with a fixed set of permissions;
 *  - classes: only WordPress's own block and alignment classes, so content cannot borrow the storefront's styling;
 *  - ids: prefixed, so a heading cannot take over an id the page itself uses ("main", ...).
 */
export interface LinkMap {
  /** WordPress permalink path (with a trailing slash) -> the storefront path it is shown at. */
  paths: ReadonlyMap<string, string>;
}

export interface SanitizeContext {
  /** The WordPress origin, e.g. https://shop.kcprintworks.com */
  wpOrigin: string;
  /** The storefront origin, e.g. https://kcprintworks.com */
  siteOrigin: string;
  links: LinkMap;
}

const ID_PREFIX = 'c-';
const SAFE_ID = /^[A-Za-z][A-Za-z0-9_.:-]{0,79}$/;
const SAFE_NUMBER = /^\d{1,5}$/;
/** Paths that exist in the storefront under the same address as in WordPress/WooCommerce. */
const SHARED_PREFIXES = ['/product/', '/product-category/', '/shop/', '/cart/', '/blog/'];
const IFRAME_ALLOW = 'accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen';
const IFRAME_SANDBOX =
  'allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox';

export function withTrailingSlash(path: string): string {
  return path.endsWith('/') ? path : `${path}/`;
}

const isLocalHost = (host: string) =>
  host === 'localhost' || host === '127.0.0.1' || host === '[::1]';

/** Where a link in WordPress content should lead, or null when it must not be a link at all. */
export function rewriteHref(href: string, ctx: SanitizeContext): string | null {
  const text = href.trim();
  if (text === '') return null;
  if (text.startsWith('#')) {
    const fragment = text.slice(1);
    return SAFE_ID.test(fragment) ? `#${ID_PREFIX}${fragment}` : null;
  }
  let url: URL;
  try {
    url = new URL(text, ctx.wpOrigin);
  } catch {
    return null;
  }
  if (url.protocol === 'mailto:' || url.protocol === 'tel:') return text;
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;

  const wp = new URL(ctx.wpOrigin);
  const site = new URL(ctx.siteOrigin);
  const sameWp = url.host === wp.host;
  const sameSite = url.host === site.host;
  if (!sameWp && !sameSite) return url.protocol === 'https:' ? url.href : null;

  const path = withTrailingSlash(url.pathname);
  const tail = `${url.search}${url.hash}`;
  if (sameSite) return `${url.pathname}${tail}`;
  const mapped = ctx.links.paths.get(path);
  if (mapped) return `${mapped}${url.hash}`;
  if (SHARED_PREFIXES.some((prefix) => path.startsWith(prefix))) return `${url.pathname}${tail}`;
  // Anything else on the shop's WordPress (checkout, account, other pages) stays a link to the shop, over https where the shop allows.
  if (url.protocol === 'http:' && !isLocalHost(url.hostname)) url.protocol = 'https:';
  return url.href;
}

function allowedImage(raw: string | undefined, ctx: SanitizeContext): string | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw.trim(), ctx.wpOrigin);
  } catch {
    return null;
  }
  if (url.protocol === 'https:') return url.href;
  // Plain http only for the WordPress origin itself, which readWpConfig accepts only for a local test address.
  if (url.protocol === 'http:' && url.origin === new URL(ctx.wpOrigin).origin) return url.href;
  return null;
}

function cleanSrcset(raw: string | undefined, ctx: SanitizeContext): string | undefined {
  if (!raw) return undefined;
  const kept: string[] = [];
  for (const candidate of raw.split(',')) {
    const [source, descriptor] = candidate.trim().split(/\s+/, 2);
    const safe = allowedImage(source, ctx);
    if (safe && (descriptor === undefined || /^\d+(\.\d+)?[wx]$/.test(descriptor))) {
      kept.push(descriptor ? `${safe} ${descriptor}` : safe);
    }
  }
  return kept.length > 0 ? kept.join(', ') : undefined;
}

const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'www.youtube-nocookie.com']);

/** The address an embed will really load from, or null when it is not one of the two allowed video services. */
export function safeEmbedSrc(raw: string | undefined): string | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw.trim(), 'https://invalid.example');
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (YOUTUBE_HOSTS.has(url.hostname) && /^\/embed\/[A-Za-z0-9_-]{1,64}\/?$/.test(url.pathname)) {
    const out = new URL(`https://www.youtube-nocookie.com${url.pathname}`);
    for (const key of ['start', 'end', 'list']) {
      const value = url.searchParams.get(key);
      if (value && /^[A-Za-z0-9_-]{1,64}$/.test(value)) out.searchParams.set(key, value);
    }
    return out.href;
  }
  if (url.hostname === 'player.vimeo.com' && /^\/video\/\d{1,12}\/?$/.test(url.pathname)) {
    const out = new URL(`https://player.vimeo.com${url.pathname}`);
    const hash = url.searchParams.get('h');
    if (hash && /^[a-f0-9]{6,20}$/i.test(hash)) out.searchParams.set('h', hash);
    out.searchParams.set('dnt', '1');
    return out.href;
  }
  return null;
}

const EMPTY_WRAPPERS = new Set(['p', 'div', 'span', 'ul', 'ol']);

/**
 * Contact Form 7 shortcodes. WordPress prints one as plain text when the form plugin is off, and the storefront cannot show forms
 * (no form, no endpoint), so the shortcode text is dropped before anything else.
 */
const FORM_SHORTCODE = /\[\/?contact-form-7\b[^\]]*\]/gi;

export function sanitizeContent(html: string, ctx: SanitizeContext): string {
  html = html.replace(FORM_SHORTCODE, '');
  const headings = ['h2', 'h3', 'h4', 'h5', 'h6'];
  const headingTransforms = Object.fromEntries(
    ['h1', ...headings].map((tag) => [
      tag,
      (_name: string, attribs: sanitizeHtml.Attributes) => {
        const next: sanitizeHtml.Attributes = { ...attribs };
        // The page's own title is the only h1; a heading in the content starts at h2.
        const name = tag === 'h1' ? 'h2' : tag;
        if (next.id && SAFE_ID.test(next.id)) next.id = `${ID_PREFIX}${next.id}`;
        else delete next.id;
        return { tagName: name, attribs: next };
      },
    ]),
  );
  return sanitizeHtml(html, {
    allowedTags: [
      'p',
      'br',
      'hr',
      'strong',
      'b',
      'em',
      'i',
      'u',
      's',
      'del',
      'ins',
      'mark',
      'sub',
      'sup',
      'small',
      'code',
      'pre',
      'kbd',
      'abbr',
      'ul',
      'ol',
      'li',
      ...headings,
      'blockquote',
      'cite',
      'q',
      'a',
      'img',
      'figure',
      'figcaption',
      'div',
      'span',
      'table',
      'thead',
      'tbody',
      'tfoot',
      'tr',
      'th',
      'td',
      'caption',
      'iframe',
    ],
    allowedAttributes: {
      '*': ['class'],
      a: ['href', 'title', 'rel'],
      img: ['src', 'srcset', 'sizes', 'alt', 'width', 'height', 'loading', 'decoding'],
      iframe: [
        'src',
        'title',
        'width',
        'height',
        'allow',
        'allowfullscreen',
        'loading',
        'referrerpolicy',
        'sandbox',
      ],
      h2: ['id'],
      h3: ['id'],
      h4: ['id'],
      h5: ['id'],
      h6: ['id'],
      td: ['colspan', 'rowspan'],
      th: ['colspan', 'rowspan', 'scope'],
      abbr: ['title'],
      q: ['cite'],
      blockquote: ['cite'],
    },
    allowedClasses: {
      '*': [
        'wp-block-*',
        'wp-element-caption',
        'wp-image-*',
        'wp-embed-aspect-*',
        'wp-has-aspect-ratio',
        'align*',
        'has-text-align-*',
        'is-style-*',
        'is-layout-*',
        'size-*',
      ],
    },
    // Plain http is allowed through only when the WordPress address itself is plain http (a local test address, see readWpConfig);
    // rewriteHref has already refused every other http address.
    allowedSchemes: [
      'https',
      'mailto',
      'tel',
      ...(ctx.wpOrigin.startsWith('http:') ? ['http'] : []),
    ],
    allowedSchemesByTag: { img: ['https', 'http'] },
    allowedSchemesAppliedToAttributes: ['href', 'src', 'cite'],
    allowProtocolRelative: false,
    allowedIframeHostnames: ['www.youtube-nocookie.com', 'player.vimeo.com'],
    allowIframeRelativeUrls: false,
    // A form's text goes with it (its labels and buttons mean nothing without the form); a form plugin's wrappers are then empty and removed below.
    nonTextTags: ['script', 'style', 'textarea', 'option', 'noscript', 'template', 'form'],
    transformTags: {
      ...headingTransforms,
      a: (_name, attribs) => {
        const next: sanitizeHtml.Attributes = { rel: 'noopener noreferrer' };
        if (attribs.title) next.title = attribs.title;
        if (attribs.class) next.class = attribs.class;
        const href = attribs.href ? rewriteHref(attribs.href, ctx) : null;
        if (href) next.href = href;
        return { tagName: 'a', attribs: next };
      },
      img: (_name, attribs) => {
        const src = allowedImage(attribs.src, ctx);
        const next: sanitizeHtml.Attributes = {
          alt: attribs.alt ?? '',
          loading: 'lazy',
          decoding: 'async',
        };
        if (attribs.class) next.class = attribs.class;
        if (src) next.src = src;
        const srcset = cleanSrcset(attribs.srcset, ctx);
        if (srcset) {
          next.srcset = srcset;
          if (attribs.sizes && /^[\w\s()%,.:<>=-]{1,200}$/.test(attribs.sizes))
            next.sizes = attribs.sizes;
        }
        if (attribs.width && SAFE_NUMBER.test(attribs.width)) next.width = attribs.width;
        if (attribs.height && SAFE_NUMBER.test(attribs.height)) next.height = attribs.height;
        return { tagName: 'img', attribs: next };
      },
      iframe: (_name, attribs) => {
        const src = safeEmbedSrc(attribs.src);
        const next: sanitizeHtml.Attributes = {};
        if (src) {
          next.src = src;
          next.title = (attribs.title ?? 'Embedded video').slice(0, 120);
          next.allow = IFRAME_ALLOW;
          next.allowfullscreen = 'allowfullscreen';
          next.loading = 'lazy';
          next.referrerpolicy = 'strict-origin-when-cross-origin';
          next.sandbox = IFRAME_SANDBOX;
          if (attribs.width && SAFE_NUMBER.test(attribs.width)) next.width = attribs.width;
          if (attribs.height && SAFE_NUMBER.test(attribs.height)) next.height = attribs.height;
          if (attribs.class) next.class = attribs.class;
        }
        return { tagName: 'iframe', attribs: next };
      },
    },
    // An image without a usable source and a frame without an allowed address are removed, not left as empty boxes.
    exclusiveFilter: (frame) => {
      if ((frame.tag === 'iframe' || frame.tag === 'img') && !frame.attribs.src) return true;
      // What a removed form or shortcode leaves behind: wrappers with no text and no picture or video in them.
      return (
        EMPTY_WRAPPERS.has(frame.tag) &&
        frame.text.trim() === '' &&
        frame.mediaChildren.length === 0
      );
    },
  });
}

/** Plain text of some HTML (tags removed, entities decoded), for titles, excerpts and metadata. */
export function plainText(html: string): string {
  const stripped = sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} });
  return decodeEntities(stripped).replace(/\s+/g, ' ').trim();
}

const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  ndash: '–',
  mdash: '—',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  copy: '©',
  reg: '®',
  trade: '™',
  times: '×',
};

/** The entities WordPress writes into titles and excerpts. Unknown names are left exactly as they came. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body.startsWith('#')) {
      const code =
        body[1]?.toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isInteger(code) &&
        code > 0 &&
        code <= 0x10ffff &&
        !(code >= 0xd800 && code <= 0xdfff)
        ? String.fromCodePoint(code)
        : whole;
    }
    return NAMED[body.toLowerCase()] ?? whole;
  });
}
