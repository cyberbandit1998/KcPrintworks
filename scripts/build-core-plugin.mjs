#!/usr/bin/env node
// Builds dist/kcpw-core.zip: the WordPress plugin as an installable package (Plugins > Add New > Upload Plugin).
// Tests and docs are left out; only what WordPress needs is shipped.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const source = join(root, 'wordpress/kcpw-core');
const dist = join(root, 'dist');
const stage = join(dist, 'stage', 'kcpw-core');

rmSync(join(dist, 'stage'), { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
for (const entry of ['kcpw-core.php', 'uninstall.php', 'README.md', 'src']) {
  cpSync(join(source, entry), join(stage, entry), { recursive: true });
}

const version =
  /Version:\s+(\S+)/.exec(readFileSync(join(source, 'kcpw-core.php'), 'utf8'))?.[1] ?? '0.0.0';
const zipPath = join(dist, 'kcpw-core.zip');
rmSync(zipPath, { force: true });
const result = spawnSync('zip', ['-qr', zipPath, 'kcpw-core'], {
  cwd: join(dist, 'stage'),
  encoding: 'utf8',
});
if (result.status !== 0 || !existsSync(zipPath)) {
  console.error(`zip failed: ${result.stderr || result.error}`);
  process.exit(1);
}
rmSync(join(dist, 'stage'), { recursive: true, force: true });
console.log(`Built ${zipPath} (plugin version ${version})`);
