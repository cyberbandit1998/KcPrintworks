/**
 * The reference pictures a customer may attach to a quote request. Checked here (the first of two checks: the plugin checks again
 * and re-saves each picture) by what the bytes ARE, never by the name or the type the browser claims. Only common picture formats:
 * no SVG (it can carry script), no PDF, no HEIC (browsers turn those into JPEG when asked for pictures).
 */
export const UPLOAD_LIMITS = {
  maxFiles: 4,
  maxFileBytes: 2_621_440, // 2.5 MB each
  maxTotalBytes: 5_242_880, // 5 MB together
} as const;

export type ImageKind = 'jpeg' | 'png' | 'webp' | 'gif';
export const IMAGE_TYPES: Record<ImageKind, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
};

export function detectImageKind(bytes: Uint8Array): ImageKind | null {
  const at = (i: number) => bytes[i] ?? -1;
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'jpeg';
  if (
    at(0) === 0x89 &&
    at(1) === 0x50 &&
    at(2) === 0x4e &&
    at(3) === 0x47 &&
    at(4) === 0x0d &&
    at(5) === 0x0a &&
    at(6) === 0x1a &&
    at(7) === 0x0a
  )
    return 'png';
  if (
    at(0) === 0x52 &&
    at(1) === 0x49 &&
    at(2) === 0x46 &&
    at(3) === 0x46 &&
    at(8) === 0x57 &&
    at(9) === 0x45 &&
    at(10) === 0x42 &&
    at(11) === 0x50
  )
    return 'webp';
  if (
    at(0) === 0x47 &&
    at(1) === 0x49 &&
    at(2) === 0x46 &&
    at(3) === 0x38 &&
    (at(4) === 0x37 || at(4) === 0x39) &&
    at(5) === 0x61
  )
    return 'gif';
  return null;
}

/** A file name safe to show and to store: no path, no control characters, only plain characters, at most 60, and the extension of what the file really is. */
export function safeFileName(original: string, kind: ImageKind): string {
  const base = original
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/\p{C}+/gu, '')
    .split(/[\\/]/)
    .pop()!
    .replace(/\.[A-Za-z0-9]{1,6}$/, '')
    .replace(/[^A-Za-z0-9 ._()-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[. -]+|[. -]+$/g, '')
    .slice(0, 50)
    .trim();
  const ext = kind === 'jpeg' ? 'jpg' : kind;
  return `${base || 'reference'}.${ext}`;
}

export interface PreparedFile {
  name: string;
  type: string;
  /** base64 of the bytes */
  data: string;
}

export type FileProblem =
  | { code: 'too_many'; message: string }
  | { code: 'too_large'; message: string }
  | { code: 'bad_type'; message: string; name: string };

/** Checks a set of uploads; returns the files ready to send, or the first problem in words a customer can act on. */
export async function prepareUploads(
  files: readonly { name: string; size: number; arrayBuffer(): Promise<ArrayBuffer> }[],
): Promise<{ ok: true; files: PreparedFile[] } | { ok: false; problem: FileProblem }> {
  if (files.length > UPLOAD_LIMITS.maxFiles) {
    return {
      ok: false,
      problem: {
        code: 'too_many',
        message: `Please attach at most ${UPLOAD_LIMITS.maxFiles} pictures.`,
      },
    };
  }
  let total = 0;
  const out: PreparedFile[] = [];
  for (const file of files) {
    if (file.size > UPLOAD_LIMITS.maxFileBytes) {
      return {
        ok: false,
        problem: {
          code: 'too_large',
          message: `"${file.name || 'A picture'}" is larger than 2.5 MB. Please choose a smaller one.`,
        },
      };
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    total += bytes.byteLength;
    if (bytes.byteLength > UPLOAD_LIMITS.maxFileBytes || total > UPLOAD_LIMITS.maxTotalBytes) {
      return {
        ok: false,
        problem: {
          code: 'too_large',
          message: 'The pictures together are larger than 5 MB. Please send fewer or smaller ones.',
        },
      };
    }
    const kind = detectImageKind(bytes);
    if (kind === null) {
      return {
        ok: false,
        problem: {
          code: 'bad_type',
          name: file.name,
          message: `"${file.name || 'A file'}" is not a JPEG, PNG, WebP or GIF picture.`,
        },
      };
    }
    out.push({
      name: safeFileName(file.name, kind),
      type: IMAGE_TYPES[kind],
      data: Buffer.from(bytes).toString('base64'),
    });
  }
  return { ok: true, files: out };
}
