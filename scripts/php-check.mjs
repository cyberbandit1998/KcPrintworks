#!/usr/bin/env node
// Lints every PHP file under wordpress/ with `php -l` and runs the plugin's PHP tests.
// Skips (with a loud message) when PHP is not installed, so a machine without PHP can still run `npm run check`;
// CI always has PHP and fails the build if it is missing (CI=true).
import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const php = spawnSync('php', ['--version'], { encoding: 'utf8' });
if (php.error || php.status !== 0) {
  if (process.env.CI) {
    console.error('PHP is required in CI to check the WordPress plugin.');
    process.exit(1);
  }
  console.warn(
    'PHP is not installed: skipping the WordPress plugin checks. Install PHP 8.1+ to run them.',
  );
  process.exit(0);
}

function* phpFiles(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* phpFiles(full);
    else if (name.endsWith('.php')) yield full;
  }
}

let failed = false;
for (const file of phpFiles(join(root, 'wordpress'))) {
  const result = spawnSync('php', ['-l', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    failed = true;
    console.error(result.stdout + result.stderr);
  }
}
if (failed) process.exit(1);

const tests = spawnSync('php', [join(root, 'wordpress/kcpw-etsy/tests/run.php')], {
  stdio: 'inherit',
});
process.exit(tests.status ?? 1);
