/** Small HTTP helpers shared by the Functions. */

export const JSON_TYPE = 'application/json; charset=utf-8';

/**
 * Headers on every Function response that is not a page: search engines have no use for API
 * answers or share images (and `_headers`, which keeps *.pages.dev out of search, does not apply
 * to Functions).
 */
export const NOINDEX = Object.freeze({ 'X-Robots-Tag': 'noindex' });

/**
 * Anti-framing and permissions headers for HTML pages. public/_headers sets the same values for
 * every static file (tests/functions/headers.test.ts keeps the two in sync); Function pages
 * (/r/{code}) add them themselves because `_headers` does not apply to Functions.
 */
export const PAGE_SECURITY_HEADERS = Object.freeze({
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "frame-ancestors 'none'",
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
});

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': JSON_TYPE, 'X-Content-Type-Options': 'nosniff', ...NOINDEX, ...headers },
  });
}

/** JSON error body `{ error }`, never cached. */
export function errorResponse(status: number, error: string, headers: Record<string, string> = {}): Response {
  return json({ error }, status, { 'Cache-Control': 'no-store', ...headers });
}

export function noContent(headers: Record<string, string> = {}): Response {
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store', ...NOINDEX, ...headers } });
}

export function methodNotAllowed(allow: string[]): Response {
  return errorResponse(405, `Use ${allow.join(' or ')}.`, { Allow: allow.join(', ') });
}

/**
 * Whether a POST comes from a page on this site (CSRF guard for the write endpoints).
 *
 * Browsers send `Sec-Fetch-Site` on every request (all current engines) and `Origin` on every
 * cross-origin POST, including `mode: 'no-cors'` fetches and `navigator.sendBeacon`. A request that
 * carries either header must say it is same-origin; a request with neither (curl, a server) is not
 * a browser acting for a visitor, so it is left to the rate limit like before.
 */
export function sameOrigin(request: Request): boolean {
  const site = request.headers.get('Sec-Fetch-Site');
  if (site !== null && site !== 'same-origin') return false;
  const origin = request.headers.get('Origin');
  if (origin !== null) {
    try {
      if (origin !== new URL(request.url).origin) return false;
    } catch {
      return false;
    }
  }
  return true;
}

export function forbiddenCrossSite(): Response {
  return errorResponse(403, 'Requests must come from this site.');
}

/** Largest request body the POST endpoints read. */
export const MAX_BODY_BYTES = 2048;

export type BodyResult = { ok: true; value: unknown } | { ok: false; status: 400 | 413 | 415; error: string };

export interface ReadBodyOptions {
  maxBytes?: number;
  /**
   * Accept `text/plain` (and no content type) as well as `application/json`. navigator.sendBeacon
   * sends strings as text/plain, so /api/event needs it; /api/vote does not (the island posts
   * application/json, and a cross-site JSON POST needs a CORS preflight, which the 405 on OPTIONS
   * refuses).
   */
  allowTextPlain?: boolean;
}

const tooLarge = (): BodyResult => ({ ok: false, status: 413, error: 'Request body too large.' });

/**
 * Read a small JSON body. The size cap is enforced while streaming, so a body without a
 * Content-Length (chunked) is never buffered past `maxBytes`.
 */
export async function readJsonBody(request: Request, opts: ReadBodyOptions = {}): Promise<BodyResult> {
  const maxBytes = opts.maxBytes ?? MAX_BODY_BYTES;
  const type = (request.headers.get('Content-Type') ?? '').split(';')[0]!.trim().toLowerCase();
  const typeOk = type === 'application/json' || (opts.allowTextPlain === true && (type === 'text/plain' || type === ''));
  if (!typeOk) {
    return { ok: false, status: 415, error: opts.allowTextPlain ? 'Send JSON (application/json or text/plain).' : 'Send JSON (Content-Type: application/json).' };
  }
  const declared = Number(request.headers.get('Content-Length') ?? '0');
  if (declared > maxBytes) return tooLarge();
  const bytes = new Uint8Array(maxBytes);
  let size = 0;
  if (request.body) {
    const reader = request.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (size + value.byteLength > maxBytes) {
          await reader.cancel().catch(() => undefined);
          return tooLarge();
        }
        bytes.set(value, size);
        size += value.byteLength;
      }
    } catch {
      return { ok: false, status: 400, error: 'Could not read the request body.' };
    }
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, size));
  } catch {
    return { ok: false, status: 400, error: 'Request body is not valid UTF-8.' };
  }
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
