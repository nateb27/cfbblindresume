/** Small HTTP helpers shared by the Functions. */

export const JSON_TYPE = 'application/json; charset=utf-8';

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': JSON_TYPE, 'X-Content-Type-Options': 'nosniff', ...headers },
  });
}

/** JSON error body `{ error }`, never cached. */
export function errorResponse(status: number, error: string, headers: Record<string, string> = {}): Response {
  return json({ error }, status, { 'Cache-Control': 'no-store', ...headers });
}

export function noContent(): Response {
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
}

export function methodNotAllowed(allow: string[]): Response {
  return errorResponse(405, `Use ${allow.join(' or ')}.`, { Allow: allow.join(', ') });
}

/** Largest request body the POST endpoints read. */
export const MAX_BODY_BYTES = 2048;

export type BodyResult = { ok: true; value: unknown } | { ok: false; status: 400 | 413 | 415; error: string };

/**
 * Read a small JSON body. Accepts `application/json` and `text/plain` (navigator.sendBeacon sends
 * strings as text/plain, which also avoids a CORS preflight) or no content type.
 */
export async function readJsonBody(request: Request, maxBytes = MAX_BODY_BYTES): Promise<BodyResult> {
  const type = (request.headers.get('Content-Type') ?? '').split(';')[0]!.trim().toLowerCase();
  if (type && type !== 'application/json' && type !== 'text/plain') {
    return { ok: false, status: 415, error: 'Send JSON (application/json or text/plain).' };
  }
  const declared = Number(request.headers.get('Content-Length') ?? '0');
  if (declared > maxBytes) return { ok: false, status: 413, error: 'Request body too large.' };
  let text: string;
  try {
    text = await request.text();
  } catch {
    return { ok: false, status: 400, error: 'Could not read the request body.' };
  }
  if (new TextEncoder().encode(text).length > maxBytes) return { ok: false, status: 413, error: 'Request body too large.' };
  if (!text.trim()) return { ok: false, status: 400, error: 'Empty request body.' };
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, status: 400, error: 'Request body is not valid JSON.' };
  }
}

/** Integer query parameter, or null when missing / not a plain integer. */
export function intParam(url: URL, name: string): number | null {
  const v = url.searchParams.get(name);
  if (v === null || !/^\d{1,6}$/.test(v)) return null;
  return Number(v);
}
