#!/usr/bin/env node
// Builds dist/kcpw-etsy.zip: the WordPress plugin as an installable package (Plugins > Add New > Upload Plugin).
// Tests, the command-line tool, and docs are left out; only what WordPress needs is shipped.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const source = join(root, 'wordpress/kcpw-etsy');
const dist = join(root, 'dist');
const stage = join(dist, 'stage', 'kcpw-etsy');

rmSync(join(dist, 'stage'), { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
for (const entry of ['kcpw-etsy.php', 'uninstall.php', 'README.md', 'src']) {
  cpSync(join(source, entry), join(stage, entry), { recursive: true });
}

const version =
  /Version:\s+(\S+)/.exec(readFileSync(join(source, 'kcpw-etsy.php'), 'utf8'))?.[1] ?? '0.0.0';
const zipPath = join(dist, 'kcpw-etsy.zip');
rmSync(zipPath, { force: true });
const result = spawnSync('zip', ['-qr', zipPath, 'kcpw-etsy'], {
  cwd: join(dist, 'stage'),
  encoding: 'utf8',
});
if (result.status !== 0 || !existsSync(zipPath)) {
  console.error(`zip failed: ${result.stderr || result.error}`);
  process.exit(1);
}
rmSync(join(dist, 'stage'), { recursive: true, force: true });
console.log(`Built ${zipPath} (plugin version ${version})`);
