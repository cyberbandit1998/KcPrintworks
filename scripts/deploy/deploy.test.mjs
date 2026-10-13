import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const DEPLOY = resolve(import.meta.dirname, '../../deploy');

/**
 * A fake `docker` that records every call and answers from a tiny state machine, so the deploy script's
 * decisions can be tested without a Docker daemon. It also lets the test prove what the script never does.
 */
const SHIM = `#!/usr/bin/env bash
echo "$*" >> "$SHIM_LOG"
tag() { grep -E '^IMAGE_TAG=' .env | tail -1 | cut -d= -f2-; }
case "$1 $2" in
  "compose pull")
    case " $SHIM_PULL_FAIL " in *" $(tag) "*) exit 1;; esac
    echo "$(tag)" >> "$SHIM_LOCAL_IMAGES"
    ;;
  "compose up") echo "$(tag)" > "$SHIM_RUNNING" ;;
  "compose config") echo "ghcr.io/owner/kcprintworks-nextjs:$(tag)" ;;
  "image inspect")
    t="\${3##*:}"; grep -qx "$t" "$SHIM_LOCAL_IMAGES" 2>/dev/null || exit 1
    ;;
  "inspect --format")
    running=$(cat "$SHIM_RUNNING" 2>/dev/null || true)
    case " $SHIM_UNHEALTHY " in *" $running "*) echo unhealthy;; *) [ -n "$running" ] && echo healthy || echo missing;; esac
    ;;
  "logs --tail") echo "fake log line" ;;
esac
exit 0
`;

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'kcpw-deploy-'));
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'docker'), SHIM);
  chmodSync(join(bin, 'docker'), 0o755);
  copyFileSync(join(DEPLOY, 'deploy.sh'), join(dir, 'deploy.sh'));
  copyFileSync(join(DEPLOY, '.env.example'), join(dir, '.env.example'));
  const state = {
    SHIM_LOG: join(dir, 'docker.log'),
    SHIM_RUNNING: join(dir, 'running'),
    SHIM_LOCAL_IMAGES: join(dir, 'local-images'),
  };
  writeFileSync(state.SHIM_LOG, '');
  const run = (args, extraEnv = {}) =>
    spawnSync('bash', [join(dir, 'deploy.sh'), ...args], {
      cwd: dir,
      encoding: 'utf8',
      env: {
        PATH: `${bin}:${process.env.PATH}`,
        ...state,
        SHIM_UNHEALTHY: '',
        SHIM_PULL_FAIL: '',
        DEPLOY_WAIT_SECONDS: '2',
        DEPLOY_POLL_SECONDS: '1',
        ...extraEnv,
      },
    });
  const read = (name) => readFileSync(join(dir, name), 'utf8');
  const tag = () => /^IMAGE_TAG=(.*)$/m.exec(read('.env'))?.[1];
  const calls = () => read('docker.log').split('\n').filter(Boolean);
  return { run, read, tag, calls, dir };
}

test('first install creates .env, pulls, starts, waits for health, and records the deploy', () => {
  const s = sandbox();
  const r = s.run(['sha-aaaaaaa']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(s.tag(), 'sha-aaaaaaa');
  assert.match(s.read('.deploy-history'), / sha-aaaaaaa deployed\n$/);
  assert.ok(s.calls().includes('compose pull'));
  assert.ok(s.calls().includes('compose up -d'));
});

test('an update keeps every other setting in .env', () => {
  const s = sandbox();
  s.run(['sha-aaaaaaa']);
  const before = s.read('.env').replace(/^IMAGE_TAG=.*$/m, '');
  const r = s.run(['sha-bbbbbbb']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(s.read('.env').replace(/^IMAGE_TAG=.*$/m, ''), before);
  assert.equal(s.tag(), 'sha-bbbbbbb');
});

test('a new version that never becomes healthy is rolled back automatically', () => {
  const s = sandbox();
  s.run(['sha-good111']);
  const r = s.run(['sha-bad2222'], { SHIM_UNHEALTHY: 'sha-bad2222' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /rolled back to sha-good111/);
  assert.equal(s.tag(), 'sha-good111');
  assert.ok(!s.read('.deploy-history').includes('sha-bad2222'));
  assert.equal(s.read('running').trim(), 'sha-good111');
});

test('a tag that cannot be pulled changes nothing and never replaces the running container', () => {
  const s = sandbox();
  s.run(['sha-good111']);
  const upsBefore = s.calls().filter((c) => c === 'compose up -d').length;
  const r = s.run(['sha-nothere'], { SHIM_PULL_FAIL: 'sha-nothere' });
  assert.notEqual(r.status, 0);
  assert.equal(s.tag(), 'sha-good111');
  assert.equal(s.calls().filter((c) => c === 'compose up -d').length, upsBefore);
});

test('--rollback returns to the previous version, even when the registry is unreachable', () => {
  const s = sandbox();
  s.run(['sha-aaaaaaa']);
  s.run(['sha-bbbbbbb']);
  const r = s.run(['--rollback'], { SHIM_PULL_FAIL: 'sha-aaaaaaa' }); // image is cached locally
  assert.equal(r.status, 0, r.stderr);
  assert.equal(s.tag(), 'sha-aaaaaaa');
  assert.match(r.stderr, /already on this server/);
});

test('--rollback with no earlier deploy explains what to do', () => {
  const s = sandbox();
  s.run(['sha-aaaaaaa']);
  const r = s.run(['--rollback']);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /No earlier successful deploy/);
});

test('rejects tags that could be shell or sed input', () => {
  const s = sandbox();
  for (const bad of ['a;rm -rf /', 'x|y', '../../etc', '$(id)', '-latest']) {
    const r = s.run([bad]);
    assert.notEqual(r.status, 0, bad);
  }
  assert.equal(s.calls().length, 0);
});

test('only ever talks to this compose project and the kcprintworks-nextjs container', () => {
  const s = sandbox();
  s.run(['sha-aaaaaaa']);
  s.run(['sha-bbbbbbb']);
  s.run(['sha-ccccccc'], { SHIM_UNHEALTHY: 'sha-ccccccc' });
  s.run(['--rollback']);
  s.run(['--status']);
  assert.ok(s.calls().length > 0);
  for (const call of s.calls()) {
    const [verb, sub] = call.split(' ');
    const allowed =
      (verb === 'compose' && ['pull', 'up', 'config'].includes(sub)) ||
      (verb === 'inspect' && call.endsWith(' kcprintworks-nextjs')) ||
      (verb === 'logs' && call.endsWith(' kcprintworks-nextjs')) ||
      (verb === 'exec' && sub === 'kcprintworks-nextjs') ||
      (verb === 'image' && sub === 'inspect');
    assert.ok(allowed, `unexpected docker call: ${call}`);
    assert.ok(
      !/nginx-proxy-manager|wordpress|mariadb|prune|down|\brm\b|stop|kill|network|volume/.test(
        call,
      ),
      call,
    );
  }
});
