export type JsonBodyResult =
  | { ok: true; value: unknown }
  | { ok: false; reason: 'too-large' | 'invalid-json' | 'not-declared-json' };

// Browsers post text and form bodies to other sites without asking first. Requiring JSON makes
// them ask (a CORS preflight), which this API never approves, so a web page cannot make its
// visitors' browsers spend HopReady's provider allowance.
function isDeclaredJson(contentType: string | null): boolean {
  const mediaType = contentType?.split(';')[0]?.trim().toLowerCase();
  return mediaType === 'application/json';
}

// Reads a JSON body while counting bytes, so an oversized body is refused without buffering it,
// whether or not the client declared its length.
export async function readJsonBody(request: Request, maxBytes: number): Promise<JsonBodyResult> {
  if (!isDeclaredJson(request.headers.get('content-type'))) {
    return { ok: false, reason: 'not-declared-json' };
  }
  const declaredLength = request.headers.get('content-length');
  if (declaredLength !== null && Number(declaredLength) > maxBytes) {
    return { ok: false, reason: 'too-large' };
  }
  if (!request.body) return { ok: false, reason: 'invalid-json' };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    receivedBytes += value.byteLength;
    if (receivedBytes > maxBytes) {
      await reader.cancel();
      return { ok: false, reason: 'too-large' };
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(receivedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return { ok: true, value: JSON.parse(text) };
  } catch (error) {
    // TextDecoder throws TypeError on invalid UTF-8 and JSON.parse throws SyntaxError: both mean
    // the client sent something that is not JSON. Anything else is a fault here, not theirs.
    if (error instanceof TypeError || error instanceof SyntaxError) {
      return { ok: false, reason: 'invalid-json' };
    }
    throw error;
  }
}
