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
  copyFileSync(join(DEPLOY, '.env.production.example'), join(dir, '.env.production.example'));
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
  /** A directory set up the way docs/CHECKOUT-PRODUCTION.md says: .env copied from .env.production.example. */
  const asProduction = (changes = (text) => text) =>
    writeFileSync(join(dir, '.env'), changes(read('.env.production.example')));
  return { run, read, tag, calls, dir, asProduction };
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

const dockerTargets = (calls) =>
  calls.flatMap((call) => {
    const [verb, sub, ...rest] = call.split(' ');
    if (verb === 'inspect' || verb === 'logs') return [rest[rest.length - 1] ?? sub];
    if (verb === 'exec') return [sub];
    return [];
  });

test('a staging directory manages kcprintworks-nextjs, and refuses a production image', () => {
  const s = sandbox();
  assert.equal(s.run(['sha-aaaaaaa']).status, 0);
  assert.ok(dockerTargets(s.calls()).every((name) => name === 'kcprintworks-nextjs'));
  const calls = s.calls().length;
  const r = s.run(['sha-bbbbbbb-production']);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /STAGING directory.*production image/);
  assert.equal(s.tag(), 'sha-aaaaaaa', 'the setting was not touched');
  assert.equal(s.calls().length, calls, 'and docker was not asked to do anything');
});

test('a production directory deploys a production image to its own container', () => {
  const s = sandbox();
  s.asProduction();
  const r = s.run(['sha-aaaaaaa-production']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(s.tag(), 'sha-aaaaaaa-production');
  assert.match(s.read('.deploy-history'), / sha-aaaaaaa-production deployed\n$/);
  assert.ok(dockerTargets(s.calls()).length > 0);
  assert.ok(dockerTargets(s.calls()).every((name) => name === 'kcprintworks-production'));
  assert.ok(!s.calls().some((call) => call.includes('kcprintworks-nextjs')));
  // The compose file, project and container names that keep it apart from staging come from the same .env.
  const env = s.read('.env');
  assert.match(env, /^COMPOSE_FILE=docker-compose\.production\.yml$/m);
  assert.match(env, /^COMPOSE_PROJECT_NAME=kcprintworks-production$/m);
  assert.match(env, /^CONTAINER_NAME=kcprintworks-production$/m);
});

test('a production directory refuses a staging image, and rolls back only among production images', () => {
  const s = sandbox();
  s.asProduction();
  const refused = s.run(['sha-aaaaaaa']);
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /PRODUCTION directory.*not a production image/);
  assert.equal(s.calls().length, 0);
  assert.equal(s.run(['sha-aaaaaaa-production']).status, 0);
  assert.equal(s.run(['sha-bbbbbbb-production']).status, 0);
  assert.equal(s.run(['--rollback']).status, 0);
  assert.equal(s.tag(), 'sha-aaaaaaa-production');
});

test('a production directory that would use the staging compose file or container is refused before docker runs', () => {
  for (const change of [
    (text) => text.replace(/^COMPOSE_FILE=.*\n/m, ''), // plain `docker compose` would pick the STAGING definition
    (text) => text.replace(/^COMPOSE_FILE=.*$/m, 'COMPOSE_FILE=docker-compose.yml'),
    (text) => text.replace(/^CONTAINER_NAME=.*$/m, 'CONTAINER_NAME=kcprintworks-nextjs'),
  ]) {
    const s = sandbox();
    s.asProduction(change);
    const r = s.run(['sha-aaaaaaa-production']);
    assert.notEqual(r.status, 0);
    assert.match(
      r.stderr,
      /COMPOSE_FILE=docker-compose\.production\.yml|must not be named kcprintworks-nextjs/,
    );
    assert.equal(s.calls().length, 0);
  }
});

test('the instance settings are validated like the tag: nothing odd reaches docker', () => {
  for (const [name, value] of [
    ['DEPLOY_KIND', 'prod'],
    ['CONTAINER_NAME', 'a;rm -rf /'],
    ['CONTAINER_NAME', '$(id)'],
  ]) {
    const s = sandbox();
    s.asProduction((text) => text.replace(new RegExp(`^${name}=.*$`, 'm'), `${name}=${value}`));
    const r = s.run(['sha-aaaaaaa-production']);
    assert.notEqual(r.status, 0, `${name}=${value}`);
    assert.equal(s.calls().length, 0);
  }
});

test('the production example is neither git-ignored nor left out of the image (the VPS copies it from the image)', () => {
  for (const file of ['.gitignore', '.dockerignore']) {
    const lines = readFileSync(join(DEPLOY, '..', file), 'utf8')
      .split('\n')
      .map((l) => l.trim());
    assert.ok(lines.includes('.env.*'), `${file} still hides other .env files`);
    assert.ok(
      lines.includes('!.env.production.example'),
      `${file} must let .env.production.example through`,
    );
  }
});

test('both example files describe an instance that cannot collide with the other', () => {
  const staging = readFileSync(join(DEPLOY, '.env.example'), 'utf8');
  const production = readFileSync(join(DEPLOY, '.env.production.example'), 'utf8');
  const compose = readFileSync(join(DEPLOY, 'docker-compose.production.yml'), 'utf8');
  const stagingCompose = readFileSync(join(DEPLOY, 'docker-compose.yml'), 'utf8');
  assert.match(stagingCompose, /^name: kcprintworks-nextjs$/m);
  assert.match(stagingCompose, /^ {4}container_name: kcprintworks-nextjs$/m);
  assert.ok(!/^COMPOSE_FILE=/m.test(staging) && !/^DEPLOY_KIND=production/m.test(staging));
  assert.match(production, /^DEPLOY_KIND=production$/m);
  assert.match(production, /^CHECKOUT_ENABLED=false$/m, 'production ships with checkout off');
  assert.match(production, /^CATALOG_SOURCE=woo$/m);
  assert.match(production, /^NEXT_PUBLIC_SITE_URL=https:\/\/kcprintworks\.com$/m);
  assert.match(production, /^WC_BASE_URL=https:\/\/shop\.kcprintworks\.com$/m);
  assert.match(production, /^KCPW_API_URL=https:\/\/shop\.kcprintworks\.com$/m);
  // A different service name too: Docker adds it as a DNS alias, and two containers answering to one alias split the traffic.
  assert.match(compose, /^ {2}kcprintworks-production:$/m);
  assert.ok(!/^ {2}kcprintworks-nextjs:$/m.test(compose));
  assert.match(compose, /file: docker-compose\.yml/);
  assert.ok(!/^\s+ports:/m.test(compose), 'nothing is published on the VPS');
  // No secrets in either example.
  for (const text of [staging, production]) {
    for (const name of [
      'KCPW_HANDOFF_SECRET',
      'WC_CONSUMER_KEY',
      'WC_CONSUMER_SECRET',
      'REVALIDATE_SECRET',
    ]) {
      assert.match(text, new RegExp(`^${name}=$`, 'm'), name);
    }
  }
});

// The real Compose, when it is installed (no daemon is needed to render a configuration).
const composeAvailable =
  spawnSync('docker', ['compose', 'version'], { encoding: 'utf8' }).status === 0;

test(
  'Compose renders staging and production as two projects that share nothing but the proxy network',
  { skip: !composeAvailable },
  () => {
    const render = (envExample, tag) => {
      const dir = mkdtempSync(join(tmpdir(), 'kcpw-compose-'));
      for (const file of ['docker-compose.yml', 'docker-compose.production.yml']) {
        copyFileSync(join(DEPLOY, file), join(dir, file));
      }
      writeFileSync(
        join(dir, '.env'),
        `${readFileSync(join(DEPLOY, envExample), 'utf8')}\nIMAGE_TAG=${tag}\n`.replace(
          /^IMAGE_TAG=\n/m,
          '',
        ),
      );
      const clean = Object.fromEntries(
        Object.entries(process.env).filter(([name]) => !name.startsWith('COMPOSE_')),
      );
      const result = spawnSync('docker', ['compose', 'config', '--format', 'json'], {
        cwd: dir,
        encoding: 'utf8',
        env: clean,
      });
      assert.equal(result.status, 0, result.stderr);
      return JSON.parse(result.stdout);
    };
    const staging = render('.env.example', 'sha-aaaaaaa');
    const production = render('.env.production.example', 'sha-aaaaaaa-production');

    assert.equal(staging.name, 'kcprintworks-nextjs');
    assert.deepEqual(Object.keys(staging.services), ['kcprintworks-nextjs']);
    assert.equal(staging.services['kcprintworks-nextjs'].container_name, 'kcprintworks-nextjs');

    assert.equal(production.name, 'kcprintworks-production');
    assert.deepEqual(Object.keys(production.services), ['kcprintworks-production']);
    const service = production.services['kcprintworks-production'];
    assert.equal(service.container_name, 'kcprintworks-production');
    assert.match(service.image, /\/kcprintworks-nextjs:sha-aaaaaaa-production$/);
    assert.equal(service.ports, undefined, 'nothing is published on the VPS');
    assert.deepEqual(service.expose, ['3000']);
    assert.deepEqual(Object.keys(service.networks), ['proxy']);
    assert.equal(production.networks.proxy.external, true);
    // Everything that makes the container safe is inherited from the staging definition, not copied.
    const base = staging.services['kcprintworks-nextjs'];
    for (const key of [
      'read_only',
      'cap_drop',
      'security_opt',
      'tmpfs',
      'healthcheck',
      'deploy',
      'init',
    ]) {
      assert.deepEqual(service[key], base[key], key);
    }
    // The shipped production settings: checkout off, the live catalog, and the two real addresses.
    assert.equal(service.environment.CHECKOUT_ENABLED, 'false');
    assert.equal(service.environment.CATALOG_SOURCE, 'woo');
    assert.equal(service.environment.WC_BASE_URL, 'https://shop.kcprintworks.com');
    assert.equal(service.environment.KCPW_API_URL, 'https://shop.kcprintworks.com');
    assert.equal(service.environment.NEXT_PUBLIC_SITE_URL, 'https://kcprintworks.com');
    // No two names are shared.
    assert.notEqual(production.name, staging.name);
    assert.notEqual(service.container_name, base.container_name);
  },
);
