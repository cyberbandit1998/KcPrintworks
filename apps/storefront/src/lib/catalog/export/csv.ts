/**
 * Minimal CSV reader for a WooCommerce product export (Products > Export).
 * RFC 4180: quoted fields, doubled quotes, CRLF or LF, embedded newlines, optional BOM.
 * (scripts/discovery/analyze-wc-export.mjs has the same logic for the command-line reports.)
 */
export function parseCsv(input: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') {
      record.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      record.push(field);
      field = '';
      records.push(record);
      record = [];
    } else field += ch;
  }
  if (field !== '' || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  return records;
}

export type ExportRow = Record<string, string>;

/** Rows keyed by header. Early export batches are shorter than the header: missing cells are blank. */
export function readExport(csvText: string): ExportRow[] {
  const [header = [], ...records] = parseCsv(csvText);
  return records
    .filter((r) => r.length > 1 || (r[0] ?? '') !== '')
    .map((r) => Object.fromEntries(header.map((name, i) => [name, r[i] ?? ''])));
}
