import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Words a shopper must never read. This scans the code that draws customer-facing pages, so a development note ("Proposed field",
 * "for review", "placeholder tagline") cannot come back unnoticed. Not scanned on purpose: sample content that is labeled as sample
 * and only used by the design preview (fixtures, the export source, the WordPress sample client), and the staging banner, which a
 * production build never draws (app/layout.tsx).
 */
const SRC = path.resolve(import.meta.dirname, '../../src');
const SCANNED = ['app', 'components', 'lib/catalog/display-policy.ts', 'lib/handoff/messages.ts'];

function* files(target: string): Generator<string> {
  const full = path.join(SRC, target);
  if (statSync(full).isFile()) {
    yield full;
    return;
  }
  for (const name of readdirSync(full)) {
    const child = path.join(target, name);
    if (statSync(path.join(SRC, child)).isDirectory()) yield* files(child);
    else if (/\.(ts|tsx)$/.test(name)) yield path.join(SRC, child);
  }
}

/** Only the words that can reach a page: comments are removed, because they explain the code to developers. */
function visibleText(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
}

const FORBIDDEN =
  /proposed field|for review|for design review|placeholder tagline|lorem ipsum|\bTODO\b|\bFIXME\b|\bTBD\b|personali[sz]ation notes|will become a choice list|safer than free emoji/i;

describe('customer-facing copy', () => {
  it('contains no development note or placeholder wording', () => {
    const found: string[] = [];
    for (const target of SCANNED) {
      for (const file of files(target)) {
        const text = visibleText(readFileSync(file, 'utf8'));
        const match = FORBIDDEN.exec(text);
        if (match) found.push(`${path.relative(SRC, file)}: "${match[0]}"`);
      }
    }
    expect(found).toEqual([]);
  });

  it('shows the approved footer text', () => {
    const footer = readFileSync(path.join(SRC, 'components/SiteFooter.tsx'), 'utf8').replace(
      /\s+/g,
      ' ',
    );
    expect(footer).toContain(
      'Michigan-made 3D printed game cases, personalized gifts, and practical storage solutions. Made to order with care.',
    );
  });
});
