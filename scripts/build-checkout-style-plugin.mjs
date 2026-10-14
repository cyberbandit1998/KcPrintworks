#!/usr/bin/env node
// Builds dist/kcpw-checkout-style.zip: the checkout-styling plugin as an installable package (Plugins > Add New > Upload Plugin).
// Tests, the rendering fixture and docs are left out; only what WordPress needs is shipped.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const source = join(root, 'wordpress/kcpw-checkout-style');
const dist = join(root, 'dist');
const stage = join(dist, 'stage-checkout-style', 'kcpw-checkout-style');

rmSync(join(dist, 'stage-checkout-style'), { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
for (const entry of ['kcpw-checkout-style.php', 'README.md', 'src', 'assets']) {
  cpSync(join(source, entry), join(stage, entry), { recursive: true });
}

const version =
  /Version:\s+(\S+)/.exec(readFileSync(join(source, 'kcpw-checkout-style.php'), 'utf8'))?.[1] ??
  '0.0.0';
const zipPath = join(dist, 'kcpw-checkout-style.zip');
rmSync(zipPath, { force: true });
const result = spawnSync('zip', ['-qr', zipPath, 'kcpw-checkout-style'], {
  cwd: join(dist, 'stage-checkout-style'),
  encoding: 'utf8',
});
if (result.status !== 0 || !existsSync(zipPath)) {
  console.error(`zip failed: ${result.stderr || result.error}`);
  process.exit(1);
}
rmSync(join(dist, 'stage-checkout-style'), { recursive: true, force: true });
console.log(`Built ${zipPath} (plugin version ${version})`);
