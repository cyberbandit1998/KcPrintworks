/** Reads at most `limit` bytes of a request body, whatever Content-Length claims (chunked bodies have none). Null if it is larger. */
export async function readBodyLimited(request: Request, limit: number): Promise<Buffer | null> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > limit) return null;
  const reader = request.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return Buffer.concat(chunks);
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
}

export const NO_STORE = { 'Cache-Control': 'no-store' } as const;
