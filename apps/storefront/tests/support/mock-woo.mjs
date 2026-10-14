// A stand-in for the WooCommerce REST API (v3), for tests and for trying the storefront with no live store. It answers
// GET only (anything else is refused and counted), requires the same Basic credentials the storefront sends, and lets a
// test change the "store" through /__mock/ so the revalidation flow can be exercised end to end.
//
//   node tests/support/mock-woo.mjs 3200
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { createFixture } from './woo-fixture.mjs';
import {
  answerStoreReviews,
  answerWp,
  createReviewsFixture,
  createWpFixture,
} from './wp-fixture.mjs';

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="#c7d2d6"/></svg>';

export const MOCK_KEY = 'ck_mock_read_only_key';
export const MOCK_SECRET = 'cs_mock_read_only_secret';
export const MOCK_HANDOFF_SECRET = 'e2e-handoff-secret-not-real-0123456789abcdef';

// ---- a stand-in for the kcpw-core plugin's endpoints (SYNTHETIC: enough to exercise the storefront end to end; the real
// rules live in wordpress/kcpw-core and are proven by its own tests). It verifies the request signature independently.
const cents = (price) => Math.round(Number(price) * 100);

function verifySignature(req, route, body, secret) {
  const ts = req.headers['x-kcpw-timestamp'] ?? '';
  const nonce = req.headers['x-kcpw-nonce'] ?? '';
  const signature = req.headers['x-kcpw-signature'] ?? '';
  if (
    !/^\d{9,12}$/.test(ts) ||
    !/^[A-Za-z0-9_-]{16,64}$/.test(nonce) ||
    !/^[0-9a-f]{64}$/.test(signature)
  )
    return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const bodyHash = createHash('sha256').update(Buffer.from(body, 'utf8')).digest('hex');
  const canonical = ['KCPW1', ts, nonce, req.method, route, bodyHash].join('\n');
  const expected = createHmac('sha256', secret).update(canonical, 'utf8').digest('hex');
  return (
    expected.length === signature.length &&
    timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
  );
}

function resolveLine(data, line) {
  const issues = [];
  const product = data.products.find((p) => p.id === line.productId && p.status === 'publish');
  if (!product)
    return {
      issues: [{ code: 'unknown_product', message: 'This item is no longer available.' }],
      unit: 0,
      name: 'Unavailable item',
    };
  let unit = cents(product.price);
  if (product.type === 'variable') {
    const variation = (data.variations.get(product.id) ?? []).find(
      (v) => v.id === line.variationId && v.status === 'publish',
    );
    if (!variation)
      issues.push({ code: 'invalid_variation', message: 'Choose a valid option for this item.' });
    else {
      unit = cents(variation.price);
      for (const attr of product.attributes.filter((a) => a.variation)) {
        const slug = attr.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        const fixed = variation.attributes.find((a) => a.name === attr.name)?.option ?? '';
        if (fixed === '' && !(line.attributes ?? {})[slug])
          issues.push({
            code: 'invalid_variation',
            message: `Choose a ${attr.name.toLowerCase()}.`,
          });
      }
      if (variation.stock_status === 'outofstock')
        issues.push({ code: 'out_of_stock', message: `${product.name} is out of stock.` });
    }
  } else if (product.stock_status === 'outofstock') {
    issues.push({ code: 'out_of_stock', message: `${product.name} is out of stock.` });
  }
  const schema = product.meta_data.find((m) => m.key === '_kcpw_option_schema');
  const options = line.options ?? {};
  if (!schema) {
    for (const key of Object.keys(options))
      issues.push({ code: 'invalid_option', field: key, message: `Unknown option "${key}".` });
  } else {
    const fields = JSON.parse(schema.value).fields;
    for (const key of Object.keys(options))
      if (!fields.some((f) => f.id === key))
        issues.push({ code: 'invalid_option', field: key, message: `Unknown option "${key}".` });
    for (const f of fields) {
      const v = options[f.id];
      if (f.required && (typeof v !== 'string' || v.trim() === ''))
        issues.push({ code: 'invalid_option', field: f.id, message: `${f.label} is required.` });
      else if (typeof v === 'string' && v.length > f.maxLength)
        issues.push({
          code: 'invalid_option',
          field: f.id,
          message: `${f.label} must be at most ${f.maxLength} characters.`,
        });
    }
  }
  return { issues, unit, name: product.name };
}

export function createMockWoo({ port = 0, key = MOCK_KEY, secret = MOCK_SECRET } = {}) {
  let host = `http://127.0.0.1:${port}`;
  let data = createFixture(host);
  let wp = createWpFixture(host);
  let reviews = createReviewsFixture();
  const log = {
    requests: [],
    writes: 0,
    unauthorized: 0,
    core: [],
    wp: [],
    store: [],
    reviews: [],
  };
  const handoffs = new Map();
  // How the stand-in shop answers a handoff: normal | down (503) | foreign_redirect | wrong_path (a hostile or broken shop).
  let handoffMode = 'normal';
  // How the stand-in plugin answers a review submission: normal | closed | verification | notfound | limited | error | down.
  let reviewMode = 'normal';
  const expected = `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}`;

  const json = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'content-type': 'application/json', ...headers });
    res.end(JSON.stringify(body));
  };
  const paged = (url, rows, res) => {
    const perPage = Math.min(100, Number(url.searchParams.get('per_page') ?? 10));
    const page = Number(url.searchParams.get('page') ?? 1);
    json(res, 200, rows.slice((page - 1) * perPage, page * perPage), {
      'x-wp-total': String(rows.length),
      'x-wp-totalpages': String(Math.max(1, Math.ceil(rows.length / perPage))),
    });
  };

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', host);
    // ---- test controls (not part of WooCommerce)
    if (url.pathname.startsWith('/__mock/')) {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const input = body ? JSON.parse(body) : {};
        if (url.pathname === '/__mock/log') return json(res, 200, log);
        if (url.pathname === '/__mock/reset') {
          data = createFixture(host);
          wp = createWpFixture(host);
          reviews = createReviewsFixture();
          log.wp = [];
          log.store = [];
          log.requests = [];
          log.writes = 0;
          log.unauthorized = 0;
          log.core = [];
          handoffs.clear();
          handoffMode = 'normal';
          reviewMode = 'normal';
          log.reviews = [];
          return json(res, 200, { ok: true });
        }
        if (url.pathname === '/__mock/product') {
          const row = data.products.find((p) => p.id === input.id);
          if (!row) return json(res, 404, { error: 'no such product' });
          Object.assign(row, input.fields, {
            date_modified_gmt: new Date().toISOString().slice(0, 19),
          });
          return json(res, 200, { ok: true });
        }
        // Add `count` published products to one category (for pagination tests); a reset removes them again.
        if (url.pathname === '/__mock/bulk') {
          const categoryId = Number(input.categoryId);
          const found = data.categories.find((c) => c.id === categoryId);
          if (!found) return json(res, 404, { error: 'no such category' });
          for (let n = 1; n <= Number(input.count ?? 0); n += 1) {
            const id = 1000 + n;
            data.products.push({
              ...data.products.find((p) => p.id === 109),
              id,
              name: `Synthetic Bulk ${String(n).padStart(2, '0')}`,
              slug: `synthetic-bulk-${String(n).padStart(2, '0')}`,
              price: '5.00',
              regular_price: '5.00',
              categories: [{ id: found.id, name: found.name, slug: found.slug }],
              date_created_gmt: `2026-07-${String(n).padStart(2, '0')}T10:00:00`,
              menu_order: 50,
            });
          }
          return json(res, 200, { ok: true });
        }
        if (url.pathname === '/__mock/category') {
          const row = data.categories.find((c) => c.id === input.id);
          if (!row) return json(res, 404, { error: 'no such category' });
          Object.assign(row, input.fields);
          return json(res, 200, { ok: true });
        }
        // Reviews (WooCommerce Store API): { failing } switches it off; { add } adds an approved review row; { remove } deletes by id.
        if (url.pathname === '/__mock/reviews') {
          if ('failing' in input) reviews.failing = Boolean(input.failing);
          if ('submitMode' in input) reviewMode = String(input.submitMode);
          if (input.add) reviews.rows.push(input.add);
          if (input.remove) reviews.rows = reviews.rows.filter((r) => r.id !== input.remove);
          return json(res, 200, { ok: true });
        }
        // WordPress content: { failing } switches the REST API off; { bulkPosts } adds published posts (pagination);
        // { addPage } / { removePage } manage pages by slug; { editPost } changes a post by id.
        if (url.pathname === '/__mock/wp') {
          if ('failing' in input) wp.failing = Boolean(input.failing);
          for (let n = 1; n <= Number(input.bulkPosts ?? 0); n += 1) {
            wp.posts.push(
              wp.post(
                100 + n,
                `bulk-post-${String(n).padStart(2, '0')}`,
                `Bulk post ${String(n).padStart(2, '0')}`,
                `2026-08-${String(n).padStart(2, '0')}`,
              ),
            );
          }
          if (input.addPage) {
            wp.pages.push({
              ...wp.post(
                900 + wp.pages.length,
                input.addPage.slug,
                input.addPage.title,
                '2026-09-02',
              ),
              type: 'page',
              categories: undefined,
              tags: undefined,
              content: { rendered: input.addPage.html, protected: false },
            });
          }
          if (input.removePage) wp.pages = wp.pages.filter((p) => p.slug !== input.removePage);
          if (input.editPost) {
            const row = wp.posts.find((p) => p.id === input.editPost.id);
            if (!row) return json(res, 404, { error: 'no such post' });
            Object.assign(row, input.editPost.fields);
          }
          return json(res, 200, { ok: true });
        }
        if (url.pathname === '/__mock/handoff') {
          handoffMode = String(input.mode ?? 'normal');
          return json(res, 200, { ok: true });
        }
        if (url.pathname === '/__mock/fail') {
          data.failing = Boolean(input.failing);
          return json(res, 200, { ok: true });
        }
        return json(res, 404, { error: 'unknown control' });
      });
      return;
    }
    if (url.pathname.startsWith('/images/')) {
      res.writeHead(200, {
        'content-type': 'image/svg+xml',
        'cache-control': 'public, max-age=60',
      });
      return res.end(SVG);
    }

    // ---- WordPress REST (wp/v2): public content, answered WITHOUT credentials like the real thing. The log records whether a
    // credential was ever sent, because the storefront must not send one to read published posts.
    if (url.pathname.startsWith('/wp-json/wp/v2/')) {
      log.wp.push({
        method: req.method,
        path: url.pathname,
        search: url.search,
        credentialSent: Boolean(req.headers.authorization),
      });
      if (req.method !== 'GET') return json(res, 405, { code: 'mock_read_only' });
      const answer = answerWp(url, wp);
      return json(res, answer.status, answer.body, answer.headers);
    }

    // ---- WooCommerce Store API (public): approved reviews. Answered WITHOUT credentials like the real one.
    if (url.pathname.startsWith('/wp-json/wc/store/v1/')) {
      log.store.push({
        method: req.method,
        path: url.pathname,
        search: url.search,
        credentialSent: Boolean(req.headers.authorization),
      });
      if (req.method !== 'GET') return json(res, 405, { code: 'mock_read_only' });
      const answer = answerStoreReviews(url, reviews);
      return json(res, answer.status, answer.body, answer.headers);
    }

    // ---- kcpw-core stand-in
    if (url.pathname.startsWith('/wp-json/kcpw/v1/')) {
      let raw = '';
      req.setEncoding('utf8');
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        const route = url.pathname.replace('/wp-json', '');
        log.core.push({ method: req.method, route, body: raw, headers: { ...req.headers } });
        if (!verifySignature(req, route, raw, MOCK_HANDOFF_SECRET))
          return json(res, 401, { code: 'kcpw_unauthorized', message: 'Not authorized.' });
        if (route === '/kcpw/v1/status' && req.method === 'GET') {
          return json(res, 200, {
            ok: true,
            plugin: '0.1.0-mock',
            woocommerce: '9.9.9',
            currency: 'USD',
            storefrontUrlConfigured: true,
            stripeActive: true,
            stripeTestMode: true,
          });
        }
        // A review submission. Only the fields the storefront may send are accepted. The review is only LOGGED here (for the test
        // to inspect): it is never added to the Store API stand-in, so no test can ever publish a testimonial.
        if (route === '/kcpw/v1/reviews' && req.method === 'POST') {
          if (reviewMode === 'down')
            return json(res, 503, { code: 'kcpw_not_ready', message: 'Not set up.' });
          let review;
          try {
            review = JSON.parse(raw);
          } catch {
            return json(res, 400, { ok: false, status: 'invalid_request' });
          }
          const allowed = ['productId', 'rating', 'name', 'email', 'review', 'clientKey'];
          const extra = Object.keys(review).filter((k) => !allowed.includes(k));
          if (extra.length)
            return json(res, 400, {
              ok: false,
              status: 'invalid_request',
              problems: extra.map((field) => ({
                field,
                code: 'unknown_field',
                message: 'Unknown field.',
              })),
            });
          log.reviews.push(review);
          const refusals = {
            closed: [403, 'reviews_closed'],
            verification: [403, 'verification_required'],
            notfound: [404, 'product_not_found'],
            limited: [429, 'rate_limited'],
            error: [500, 'server_error'],
          };
          const refusal = refusals[reviewMode];
          if (refusal) return json(res, refusal[0], { ok: false, status: refusal[1] });
          return json(res, 200, { ok: true, status: 'received' });
        }
        if (route !== '/kcpw/v1/cart/handoff' || req.method !== 'POST')
          return json(res, 404, { code: 'rest_no_route' });
        if (handoffMode === 'down')
          return json(res, 503, {
            code: 'kcpw_not_ready',
            message: 'The checkout link is not set up.',
          });
        let body;
        try {
          body = JSON.parse(raw);
        } catch {
          return json(res, 400, {
            ok: false,
            status: 'invalid_request',
            problems: ['The request is not valid JSON.'],
          });
        }
        const extra = Object.keys(body).filter((k) => !['lines', 'expectedSubtotal'].includes(k));
        const lineExtra = (body.lines ?? []).flatMap((l) =>
          Object.keys(l).filter(
            (k) => !['productId', 'variationId', 'attributes', 'quantity', 'options'].includes(k),
          ),
        );
        if (
          extra.length ||
          lineExtra.length ||
          !Array.isArray(body.lines) ||
          body.lines.length === 0
        ) {
          return json(res, 400, {
            ok: false,
            status: 'invalid_request',
            problems: ['Prices and totals are never accepted from a request.'],
          });
        }
        const resolved = body.lines.map((line, index) => ({
          index,
          ...resolveLine(data, line),
          line,
        }));
        const subtotal = resolved.reduce(
          (sum, r) => sum + (r.issues.length ? 0 : r.unit * r.line.quantity),
          0,
        );
        const lines = resolved.map((r) => ({
          index: r.index,
          productId: r.line.productId,
          name: r.name,
          quantity: r.line.quantity,
          unitPrice: r.unit,
          issues: r.issues,
        }));
        if (resolved.some((r) => r.issues.length))
          return json(res, 422, { ok: false, status: 'invalid_lines', subtotal, lines });
        if (body.expectedSubtotal !== undefined && body.expectedSubtotal !== subtotal)
          return json(res, 409, { ok: false, status: 'changed', subtotal, lines });
        const token = randomBytes(32).toString('base64url');
        handoffs.set(token, { lines: body.lines, subtotal });
        return json(res, 200, {
          ok: true,
          status: 'ok',
          currency: 'USD',
          subtotal,
          lines,
          redirectUrl:
            handoffMode === 'foreign_redirect'
              ? `https://evil.example/?kcpw_handoff=${token}`
              : handoffMode === 'wrong_path'
                ? `${host}/wp-admin/?kcpw_handoff=${token}`
                : `${host}/?kcpw_handoff=${token}`,
          expiresAt: Math.floor(Date.now() / 1000) + 600,
        });
      });
      return;
    }
    // The "shop host" front page the browser lands on: shows the cart that was handed over, once.
    if (url.pathname === '/' && url.searchParams.has('kcpw_handoff')) {
      const token = url.searchParams.get('kcpw_handoff');
      const found = handoffs.get(token);
      handoffs.delete(token);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(
        found
          ? `<!doctype html><title>Mock checkout</title><h1>Mock WooCommerce checkout</h1><pre id="cart">${JSON.stringify(found).replace(/</g, '\\u003c')}</pre>`
          : '<!doctype html><title>Mock checkout</title><h1>Link expired</h1>',
      );
    }

    log.requests.push({ method: req.method, path: url.pathname, search: url.search });
    if (req.method !== 'GET') {
      log.writes += 1;
      return json(res, 405, { code: 'mock_read_only', message: 'The mock store is read-only.' });
    }
    if (req.headers.authorization !== expected) {
      log.unauthorized += 1;
      return json(res, 401, {
        code: 'woocommerce_rest_cannot_view',
        message: 'Invalid credentials.',
      });
    }
    if (data.failing) return json(res, 503, { code: 'mock_down' });

    const prefix = '/wp-json/wc/v3';
    if (!url.pathname.startsWith(prefix)) return json(res, 404, { code: 'rest_no_route' });
    const route = url.pathname.slice(prefix.length).replace(/\/$/, '');
    if (route === '/products') {
      const status = url.searchParams.get('status') ?? 'any';
      return paged(
        url,
        data.products.filter((p) => status === 'any' || p.status === status),
        res,
      );
    }
    if (route === '/products/categories') return paged(url, data.categories, res);
    const match = /^\/products\/(\d+)\/variations$/.exec(route);
    if (match) return paged(url, data.variations.get(Number(match[1])) ?? [], res);
    return json(res, 404, { code: 'rest_no_route' });
  });

  return {
    log,
    get baseUrl() {
      return host;
    },
    async start() {
      await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
      const actual = server.address().port;
      if (actual !== port) {
        host = `http://127.0.0.1:${actual}`;
        data = createFixture(host); // photo addresses carry the real port
        wp = createWpFixture(host);
      }
      return host;
    },
    stop: () => new Promise((resolve) => server.close(() => resolve())),
    edit(id, fields) {
      Object.assign(
        data.products.find((p) => p.id === id),
        fields,
      );
    },
    get data() {
      return data;
    },
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const port = Number(process.argv[2] ?? 3200);
  const mock = createMockWoo({ port });
  // eslint-disable-next-line no-console -- a command-line helper
  mock.start().then((url) => console.log(`mock WooCommerce listening on ${url} (key ${MOCK_KEY})`));
}
