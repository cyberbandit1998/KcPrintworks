// Builds the stand-in pages the plugin's browser tests open, into the folder given as the first argument:
//   - copies the plugin's REAL assets (script, stylesheet), the Google stand-in, the pages and the PHP-generated configs;
//   - bundles the Checkout Block stand-in (real React) with Vite, which the repository already has.
// Usage: node build-fixtures.mjs <outDir>
import { build } from 'vite';
import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const plugin = join(here, '..', '..');
const out = process.argv[2];
if (!out) throw new Error('Usage: node build-fixtures.mjs <outDir>');
mkdirSync(out, { recursive: true });

for (const name of readdirSync(here)) {
  if (/\.(html|css|json)$/.test(name) || name === 'google-standin.js') cpSync(join(here, name), join(out, name));
}
for (const name of readdirSync(join(plugin, 'assets', 'js'))) {
  if (name.startsWith('kcpw-aa') && name.endsWith('.js')) cpSync(join(plugin, 'assets', 'js', name), join(out, name));
}
cpSync(join(plugin, 'assets', 'css', 'kcpw-aa.css'), join(out, 'kcpw-aa.css'));
if (existsSync(join(plugin, 'assets', 'css', 'kcpw-aa-picker.css'))) {
  cpSync(join(plugin, 'assets', 'css', 'kcpw-aa-picker.css'), join(out, 'kcpw-aa-picker.css'));
}

await build({
  configFile: false,
  logLevel: 'warn',
  root: here,
  define: { 'process.env.NODE_ENV': '"production"' },
  build: {
    outDir: out,
    emptyOutDir: false,
    minify: false,
    lib: { entry: join(here, 'block-app.src.js'), formats: ['iife'], name: 'KcpwBlockApp', fileName: () => 'block-app.js' },
  },
});
console.log('Fixtures built in ' + out);
