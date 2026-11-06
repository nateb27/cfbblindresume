/**
 * Response headers: the static site's public/_headers and the Functions' own headers must agree on
 * anti-framing / permissions, every API and image response is noindex, and body reading is capped.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { errorResponse, json, MAX_BODY_BYTES, noContent, PAGE_SECURITY_HEADERS, readJsonBody, sameOrigin } from '../../functions/_lib/http';

const root = fileURLToPath(new URL('../..', import.meta.url));

/** Parse Cloudflare's _headers format into { pattern: { header: value } }. */
function parseHeadersFile(text: string): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  let current: Record<string, string> | null = null;
  for (const line of text.split('\n')) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      current = out[line.trim()] = {};
      continue;
    }
    const i = line.indexOf(':');
    if (!current || i < 0) throw new Error(`bad _headers line: ${line}`);
    current[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

describe('public/_headers', () => {
  const rules = parseHeadersFile(readFileSync(join(root, 'public/_headers'), 'utf8'));

  it('applies the same anti-framing and permissions headers as the Function pages', () => {
    expect(rules['/*']).toEqual({ ...PAGE_SECURITY_HEADERS });
  });

  it('keeps *.pages.dev out of search and long-caches fingerprinted assets', () => {
    expect(rules['https://:project.pages.dev/*']).toEqual({ 'X-Robots-Tag': 'noindex' });
    expect(rules['https://:version.:project.pages.dev/*']).toEqual({ 'X-Robots-Tag': 'noindex' });
    expect(rules['/_astro/*']!['Cache-Control']).toContain('immutable');
  });

  it('stays within Cloudflare limits (100 rules, 2,000 characters per line)', () => {
    expect(Object.keys(rules).length).toBeLessThanOrEqual(100);
    for (const line of readFileSync(join(root, 'public/_headers'), 'utf8').split('\n')) expect(line.length).toBeLessThanOrEqual(2000);
  });
});

describe('Function response helpers', () => {
  it('API answers are noindex', () => {
    expect(json({}).headers.get('X-Robots-Tag')).toBe('noindex');
    expect(errorResponse(400, 'x').headers.get('X-Robots-Tag')).toBe('noindex');
    expect(noContent().headers.get('X-Robots-Tag')).toBe('noindex');
  });
});

describe('sameOrigin (CSRF guard)', () => {
  const req = (h: Record<string, string>) => new Request('https://cfbblindresume.com/api/vote', { method: 'POST', headers: h });
  it('accepts same-origin browser requests and requests without browser headers', () => {
    expect(sameOrigin(req({ Origin: 'https://cfbblindresume.com', 'Sec-Fetch-Site': 'same-origin' }))).toBe(true);
    expect(sameOrigin(req({ 'Sec-Fetch-Site': 'same-origin' }))).toBe(true);
    expect(sameOrigin(req({ Origin: 'https://cfbblindresume.com' }))).toBe(true);
    expect(sameOrigin(req({}))).toBe(true);
  });
  it('refuses anything a browser marks as coming from elsewhere', () => {
    expect(sameOrigin(req({ Origin: 'https://evil.example' }))).toBe(false);
    expect(sameOrigin(req({ Origin: 'http://cfbblindresume.com' }))).toBe(false);
    expect(sameOrigin(req({ Origin: 'null' }))).toBe(false);
    expect(sameOrigin(req({ 'Sec-Fetch-Site': 'cross-site' }))).toBe(false);
    expect(sameOrigin(req({ 'Sec-Fetch-Site': 'same-site' }))).toBe(false);
    expect(sameOrigin(req({ 'Sec-Fetch-Site': 'none' }))).toBe(false);
  });
});

describe('readJsonBody', () => {
  const post = (body: BodyInit | null, type?: string, extra: Record<string, string> = {}) =>
    new Request('https://x/api', { method: 'POST', headers: { ...(type ? { 'Content-Type': type } : {}), ...extra }, body });

  it('parses JSON and enforces the content type', async () => {
    expect(await readJsonBody(post('{"a":1}', 'application/json'))).toEqual({ ok: true, value: { a: 1 } });
    expect((await readJsonBody(post('{"a":1}', 'text/plain'))).ok).toBe(false);
    expect(await readJsonBody(post('{"a":1}', 'text/plain'), { allowTextPlain: true })).toEqual({ ok: true, value: { a: 1 } });
    expect(await readJsonBody(post('a=1', 'application/x-www-form-urlencoded'), { allowTextPlain: true })).toMatchObject({ ok: false, status: 415 });
  });

  it('rejects empty, invalid and oversize bodies', async () => {
    expect(await readJsonBody(post(null, 'application/json'))).toMatchObject({ ok: false, status: 400 });
    expect(await readJsonBody(post('  ', 'application/json'))).toMatchObject({ ok: false, status: 400 });
    expect(await readJsonBody(post('{', 'application/json'))).toMatchObject({ ok: false, status: 400 });
    expect(await readJsonBody(post(Uint8Array.of(0x7b, 0xff, 0x7d), 'application/json'))).toMatchObject({ ok: false, status: 400 });
    expect(await readJsonBody(post('x'.repeat(MAX_BODY_BYTES + 1), 'application/json'))).toMatchObject({ ok: false, status: 413 });
    expect(await readJsonBody(post('{}', 'application/json', { 'Content-Length': '999999' }))).toMatchObject({ ok: false, status: 413 });
    const exact = JSON.stringify({ p: 'x'.repeat(MAX_BODY_BYTES - 8) });
    expect(exact.length).toBe(MAX_BODY_BYTES);
    expect((await readJsonBody(post(exact, 'application/json'))).ok).toBe(true);
  });
});
