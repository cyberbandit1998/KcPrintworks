#!/usr/bin/env node
// Builds dist/kcpw-address-autocomplete.zip: the address autocomplete plugin as an installable package (Plugins > Add New > Upload Plugin).
// Tests, the browser-test fixtures and docs are left out; only what WordPress needs is shipped.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const source = join(root, 'wordpress/kcpw-address-autocomplete');
const dist = join(root, 'dist');
const stageRoot = join(dist, 'stage-address-autocomplete');
const stage = join(stageRoot, 'kcpw-address-autocomplete');

rmSync(stageRoot, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
for (const entry of [
  'kcpw-address-autocomplete.php',
  'uninstall.php',
  'README.md',
  'src',
  'assets',
]) {
  if (existsSync(join(source, entry)))
    cpSync(join(source, entry), join(stage, entry), { recursive: true });
}

const version =
  /Version:\s+(\S+)/.exec(
    readFileSync(join(source, 'kcpw-address-autocomplete.php'), 'utf8'),
  )?.[1] ?? '0.0.0';
const zipPath = join(dist, 'kcpw-address-autocomplete.zip');
rmSync(zipPath, { force: true });
const result = spawnSync('zip', ['-qr', zipPath, 'kcpw-address-autocomplete'], {
  cwd: stageRoot,
  encoding: 'utf8',
});
if (result.status !== 0 || !existsSync(zipPath)) {
  console.error(`zip failed: ${result.stderr || result.error}`);
  process.exit(1);
}
rmSync(stageRoot, { recursive: true, force: true });
console.log(`Built ${zipPath} (plugin version ${version})`);
