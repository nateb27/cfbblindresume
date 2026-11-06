/**
 * Test doubles for the Pages Functions: the committed glyph atlas loaded with fs, an ASSETS binding
 * serving real game data, and a tiny PNG decoder (zlib inflate + unfiltering) to check rendered
 * images. The SQLite-backed D1 lives in ./d1.ts (node:sqlite prints an experimental warning).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { buildGameData, gameDataPath, type GameData } from '@lib/game-data';
import { loadWeek } from '@lib/data-node';
import { loadAtlas, type Atlas, type AtlasJson } from '../../functions/_lib/atlas';
import type { D1Database, Env } from '../../functions/_lib/cf';

const root = fileURLToPath(new URL('../..', import.meta.url));

let atlas: Atlas | null = null;
export function testAtlas(): Atlas {
  if (!atlas) {
    const json = JSON.parse(readFileSync(join(root, 'functions/_lib/atlas.json'), 'utf8')) as AtlasJson;
    atlas = loadAtlas(json, readFileSync(join(root, 'functions/_lib/atlas.bin')));
  }
  return atlas;
}

let gd: GameData | null = null;
/** Real 2026 week 9 game data (the same payload the site emits). */
export function realGameData(): GameData {
  if (!gd) gd = buildGameData(loadWeek(2026, 9));
  return gd;
}

/* ------------------------------------------------------------------ ASSETS */

export const SHELL_HTML = `<!doctype html><html lang="en" data-theme="dark"><head><meta charset="utf-8" />
<title>A Shared Blind Resume Ranking | CFB Blind Resume</title>
<meta name="description" content="Someone ranked college football playoff resumes without seeing the names." />
<link rel="canonical" href="https://cfbblindresume.com/r" />
<meta property="og:title" content="A Shared Blind Resume Ranking | CFB Blind Resume" />
<meta property="og:image" content="https://cfbblindresume.com/og/default.png" />
</head><body><main id="main"></main></body></html>`;

/** A 1x1 PNG standing in for /og/default.png. */
export const DEFAULT_PNG = Uint8Array.from(
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'),
);

export interface FakeEnvOptions {
  /** D1 binding (undefined = no binding). */
  db?: D1Database;
  defaultImage?: boolean;
}

export function fakeEnv(opts: FakeEnvOptions = {}): Env & { assetHits: string[] } {
  const data = realGameData();
  const assetHits: string[] = [];
  const files = new Map<string, { body: string | Uint8Array; type: string }>([
    [gameDataPath(data.season, data.week), { body: JSON.stringify(data), type: 'application/json' }],
    ['/r', { body: SHELL_HTML, type: 'text/html; charset=utf-8' }],
  ]);
  if (opts.defaultImage !== false) files.set('/og/default.png', { body: DEFAULT_PNG, type: 'image/png' });
  return {
    DB: opts.db,
    IP_SALT: 'test-salt-0123456789',
    assetHits,
    ASSETS: {
      async fetch(input: Request | URL | string): Promise<Response> {
        const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
        assetHits.push(url.pathname);
        const f = files.get(url.pathname);
        if (!f) return new Response('<!doctype html><title>Not found</title>', { status: 404, headers: { 'Content-Type': 'text/html' } });
        return new Response(f.body as BodyInit, { status: 200, headers: { 'Content-Type': f.type, ETag: '"etag-' + url.pathname.length + '"' } });
      },
    },
  };
}

/* ------------------------------------------------------------------ PNG decoding */

export interface DecodedPng {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  palette: Uint8Array | null;
  /** RGB triplets, row-major. */
  rgb: Uint8Array;
  chunks: { type: string; length: number; crcOk: boolean }[];
}

function crc32(bytes: Uint8Array): number {
  let c = ~0 >>> 0;
  for (const b of bytes) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return ~c >>> 0;
}

/** Decode a non-interlaced 8-bit PNG (palette, RGB or RGBA) independently of the encoder under test. */
export function decodePng(bytes: Uint8Array): DecodedPng {
  const buf = Buffer.from(bytes);
  if (!buf.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('bad PNG signature');
  let o = 8;
  let ihdr: Buffer | null = null;
  let palette: Uint8Array | null = null;
  const idat: Buffer[] = [];
  const chunks: DecodedPng['chunks'] = [];
  while (o < buf.length) {
    const len = buf.readUInt32BE(o);
    const type = buf.toString('ascii', o + 4, o + 8);
    const body = buf.subarray(o + 8, o + 8 + len);
    const crcOk = buf.readUInt32BE(o + 8 + len) === crc32(buf.subarray(o + 4, o + 8 + len));
    chunks.push({ type, length: len, crcOk });
    if (type === 'IHDR') ihdr = body;
    else if (type === 'PLTE') palette = new Uint8Array(body);
    else if (type === 'IDAT') idat.push(body);
    o += 12 + len;
  }
  if (!ihdr) throw new Error('no IHDR');
  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  const bitDepth = ihdr[8]!;
  const colorType = ihdr[9]!;
  if (bitDepth !== 8 || ihdr[12] !== 0) throw new Error('decoder supports 8-bit non-interlaced only');
  const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : 1;
  const stride = width * bpp;
  const raw = inflateSync(Buffer.concat(idat));
  if (raw.length !== (stride + 1) * height) throw new Error(`IDAT inflates to ${raw.length}, expected ${(stride + 1) * height}`);
  const px = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)]!;
    if (f > 4) throw new Error(`bad filter ${f} on row ${y}`);
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x]!;
      const a = x >= bpp ? px[y * stride + x - bpp]! : 0;
      const b = y > 0 ? px[(y - 1) * stride + x]! : 0;
      const c = x >= bpp && y > 0 ? px[(y - 1) * stride + x - bpp]! : 0;
      let p = 0;
      if (f === 1) p = a;
      else if (f === 2) p = b;
      else if (f === 3) p = (a + b) >> 1;
      else if (f === 4) {
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      px[y * stride + x] = (v + p) & 255;
    }
  }
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    if (colorType === 3) {
      const k = px[i]!;
      if (!palette || k * 3 + 2 >= palette.length) throw new Error(`palette index ${k} out of range`);
      rgb.set(palette.subarray(k * 3, k * 3 + 3), i * 3);
    } else rgb.set(px.subarray(i * bpp, i * bpp + 3), i * 3);
  }
  return { width, height, bitDepth, colorType, palette, rgb, chunks };
}

/** "#rrggbb" of the decoded pixel at (x, y). */
export function pixelHex(img: DecodedPng, x: number, y: number): string {
  const i = (y * img.width + x) * 3;
  return `#${[img.rgb[i]!, img.rgb[i + 1]!, img.rgb[i + 2]!].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}
