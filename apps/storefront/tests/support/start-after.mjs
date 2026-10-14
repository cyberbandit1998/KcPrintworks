// Starts `next start` for the WooCommerce-backed test server once the main test server (which runs the build) is
// answering, so both can share one build:  node tests/support/start-after.mjs <wait-for-url> <port>
import { spawn } from 'node:child_process';

const [waitFor, port] = process.argv.slice(2);
const deadline = Date.now() + 230_000;
for (;;) {
  try {
    if ((await fetch(waitFor)).ok) break;
  } catch {
    // not up yet
  }
  if (Date.now() > deadline) {
    console.error(`gave up waiting for ${waitFor}`);
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 1000));
}
const child = spawn('npx', ['next', 'start', '-p', port], { stdio: 'inherit', env: process.env });
child.on('exit', (code) => process.exit(code ?? 0));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
