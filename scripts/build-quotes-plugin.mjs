#!/usr/bin/env node
// Builds dist/kcpw-quotes.zip: the custom quotes plugin as an installable package (Plugins > Add New > Upload Plugin).
// Tests and docs are left out; only what WordPress needs is shipped.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const source = join(root, 'wordpress/kcpw-quotes');
const dist = join(root, 'dist');
const stageRoot = join(dist, 'stage-quotes');
const stage = join(stageRoot, 'kcpw-quotes');

rmSync(stageRoot, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
for (const entry of ['kcpw-quotes.php', 'uninstall.php', 'README.md', 'src']) {
  cpSync(join(source, entry), join(stage, entry), { recursive: true });
}

const version =
  /Version:\s+(\S+)/.exec(readFileSync(join(source, 'kcpw-quotes.php'), 'utf8'))?.[1] ?? '0.0.0';
const zipPath = join(dist, 'kcpw-quotes.zip');
rmSync(zipPath, { force: true });
const result = spawnSync('zip', ['-qr', zipPath, 'kcpw-quotes'], {
  cwd: stageRoot,
  encoding: 'utf8',
});
if (result.status !== 0 || !existsSync(zipPath)) {
  console.error(`zip failed: ${result.stderr || result.error}`);
  process.exit(1);
}
rmSync(stageRoot, { recursive: true, force: true });
console.log(`Built ${zipPath} (plugin version ${version})`);
