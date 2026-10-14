import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import {
  buildRefreshRequest,
  main,
  normalizeBase,
  parseArgs,
  pollUntil,
  signBody,
} from './verify-catalog-freshness.mjs';

const SECRET = 'a-long-shared-secret-for-tests';

test('parseArgs reads a command and --name value pairs, and rejects strays', () => {
  assert.deepEqual(parseArgs(['wait', '--base', 'https://x.test', '--expect', 'New']), {
    command: 'wait',
    options: { base: 'https://x.test', expect: 'New' },
  });
  assert.throws(() => parseArgs(['wait', 'oops']), /Unexpected argument/);
  assert.throws(() => parseArgs(['wait', '--base']), /needs a value/);
});

test('normalizeBase demands https except for this machine', () => {
  assert.equal(
    normalizeBase('https://staging.example.com/anything'),
    'https://staging.example.com',
  );
  assert.equal(normalizeBase('http://localhost:3000'), 'http://localhost:3000');
  assert.throws(() => normalizeBase('http://staging.example.com'), /https/);
  assert.throws(() => normalizeBase('nope'), /not a URL/);
});

test('the refresh request is signed over the exact body, in the format the storefront checks', () => {
  const { url, init } = buildRefreshRequest(
    'https://s.test',
    SECRET,
    new Date('2026-10-14T00:00:00Z'),
  );
  assert.equal(url, 'https://s.test/api/revalidate/');
  assert.equal(init.method, 'POST');
  const expected = `sha256=${createHmac('sha256', SECRET).update(init.body).digest('hex')}`;
  assert.equal(init.headers['x-kcpw-signature'], expected);
  assert.equal(signBody(init.body, SECRET), expected);
  assert.ok(!JSON.stringify(init).includes(SECRET), 'the secret itself is never sent');
  assert.throws(() => buildRefreshRequest('https://s.test', undefined), /REVALIDATE_SECRET/);
  assert.throws(() => buildRefreshRequest('https://s.test', 'short'), /REVALIDATE_SECRET/);
});

test('pollUntil returns as soon as the check passes, and gives up at the timeout', async () => {
  let clock = 0;
  const options = {
    timeoutMs: 20_000,
    intervalMs: 5_000,
    sleep: async (ms) => (clock += ms),
    now: () => clock,
  };
  let calls = 0;
  const passed = await pollUntil(async () => ++calls === 3, options);
  assert.equal(passed.ok, true);
  assert.equal(passed.elapsedMs, 10_000);
  clock = 0;
  const failed = await pollUntil(async () => false, options);
  assert.equal(failed.ok, false);
  assert.ok(failed.elapsedMs <= 20_000);
});

function fakeFetch(routes) {
  const calls = [];
  const impl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const handler = routes[new URL(url).pathname];
    if (!handler) return new Response('not found', { status: 404 });
    return handler(url, init);
  };
  impl.calls = calls;
  return impl;
}

test('status prints the catalog and exits 0; a non-WooCommerce storefront fails', async () => {
  const lines = [];
  const body = {
    source: 'woo',
    status: {
      loadedAt: '2026-10-14T00:00:00.000Z',
      ageSeconds: 12,
      refreshIntervalSeconds: 120,
      lastError: null,
      failures: 0,
    },
    counts: { products: 2, categories: 1, skipped: 1 },
    skipped: [{ id: 9, title: 'Draft thing', reason: 'status is draft' }],
    products: [
      {
        id: 101,
        slug: 'a',
        name: 'A',
        price: 899,
        variations: 0,
        updatedAt: '2026-10-01T00:00:00Z',
      },
    ],
  };
  const ok = fakeFetch({ '/api/catalog-status/': () => Response.json(body) });
  assert.equal(
    await main(['status', '--base', 'https://s.test', '--product', 'a'], {
      fetchImpl: ok,
      log: (l) => lines.push(l),
    }),
    0,
  );
  assert.match(lines.join('\n'), /products: 2/);
  assert.match(lines.join('\n'), /\$8\.99/);
  assert.match(lines.join('\n'), /#9 Draft thing/);

  const fixtures = fakeFetch({
    '/api/catalog-status/': () => Response.json({ source: 'fixtures' }),
  });
  assert.equal(
    await main(['status', '--base', 'https://s.test'], { fetchImpl: fixtures, log: () => {} }),
    1,
  );
});

test('wait passes when the expected text appears and fails (exit 1) when it never does', async () => {
  let n = 0;
  const fetchImpl = fakeFetch({
    '/product/a/': () => new Response(++n >= 2 ? '<h1>New title</h1>' : '<h1>Old title</h1>'),
  });
  const lines = [];
  const code = await main(
    [
      'wait',
      '--base',
      'https://s.test',
      '--path',
      '/product/a/',
      '--expect',
      'New title',
      '--interval',
      '0.001',
      '--timeout',
      '5',
    ],
    {
      fetchImpl,
      log: (l) => lines.push(l),
    },
  );
  assert.equal(code, 0);
  assert.match(lines.join('\n'), /PASS/);

  const never = fakeFetch({ '/product/a/': () => new Response('<h1>Old title</h1>') });
  const failed = await main(
    [
      'wait',
      '--base',
      'https://s.test',
      '--path',
      '/product/a/',
      '--expect',
      'New title',
      '--interval',
      '0.001',
      '--timeout',
      '0.01',
    ],
    {
      fetchImpl: never,
      log: () => {},
    },
  );
  assert.equal(failed, 1);
});

test('wait --gone passes once the old text is gone from a page that still loads', async () => {
  const fetchImpl = fakeFetch({ '/product/a/': () => new Response('<h1>New title</h1>') });
  assert.equal(
    await main(
      [
        'wait',
        '--base',
        'https://s.test',
        '--path',
        '/product/a/',
        '--gone',
        'Old title',
        '--interval',
        '0.001',
      ],
      { fetchImpl, log: () => {} },
    ),
    0,
  );
  const broken = fakeFetch({ '/product/a/': () => new Response('error', { status: 500 }) });
  assert.equal(
    await main(
      [
        'wait',
        '--base',
        'https://s.test',
        '--path',
        '/product/a/',
        '--gone',
        'Old title',
        '--interval',
        '0.001',
        '--timeout',
        '0.01',
      ],
      {
        fetchImpl: broken,
        log: () => {},
      },
    ),
    1,
    'a broken page is not "the old text is gone"',
  );
});

test('refresh posts a signed request and explains each failure', async () => {
  const seen = [];
  const accepted = fakeFetch({
    '/api/revalidate/': (_u, init) => (seen.push(init), new Response('{}', { status: 202 })),
  });
  assert.equal(
    await main(['refresh', '--base', 'https://s.test'], {
      fetchImpl: accepted,
      log: () => {},
      env: { REVALIDATE_SECRET: SECRET },
    }),
    0,
  );
  assert.equal(seen[0].method, 'POST');

  for (const [status, hint] of [
    [401, /does not match/],
    [503, /no REVALIDATE_SECRET/],
    [404, /not using the WooCommerce/],
  ]) {
    const lines = [];
    const fetchImpl = fakeFetch({ '/api/revalidate/': () => new Response('{}', { status }) });
    assert.equal(
      await main(['refresh', '--base', 'https://s.test'], {
        fetchImpl,
        log: (l) => lines.push(l),
        env: { REVALIDATE_SECRET: SECRET },
      }),
      1,
    );
    assert.match(lines.join('\n'), hint);
  }
});

test('usage errors exit 2 and never print the secret', async () => {
  const lines = [];
  assert.equal(await main([], { log: (l) => lines.push(l) }), 2);
  assert.equal(
    await main(['refresh', '--base', 'http://staging.example.com'], {
      log: (l) => lines.push(l),
      env: { REVALIDATE_SECRET: SECRET },
    }),
    2,
  );
  assert.equal(
    await main(['wait', '--base', 'https://s.test', '--path', '/p/'], {
      log: (l) => lines.push(l),
    }),
    2,
  );
  assert.ok(!lines.join('\n').includes(SECRET));
});
