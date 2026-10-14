// A stand-in for the WooCommerce REST API (v3), for tests and for trying the storefront with no live store. It answers
// GET only (anything else is refused and counted), requires the same Basic credentials the storefront sends, and lets a
// test change the "store" through /__mock/ so the revalidation flow can be exercised end to end.
//
//   node tests/support/mock-woo.mjs 3200
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { createFixture } from './woo-fixture.mjs';

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="#c7d2d6"/></svg>';

export const MOCK_KEY = 'ck_mock_read_only_key';
export const MOCK_SECRET = 'cs_mock_read_only_secret';

export function createMockWoo({ port = 0, key = MOCK_KEY, secret = MOCK_SECRET } = {}) {
  let host = `http://127.0.0.1:${port}`;
  let data = createFixture(host);
  const log = { requests: [], writes: 0, unauthorized: 0 };
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
          log.requests = [];
          log.writes = 0;
          log.unauthorized = 0;
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
