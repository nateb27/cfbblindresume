#!/usr/bin/env node
/**
 * Build the glyph atlas for the share-image Function (/og/r/{code}.png).
 *
 * The Function runs on the Workers free plan (10 ms CPU per request), so it cannot shape or
 * rasterize a font at request time. Instead this script rasterizes every glyph it may need once,
 * at build time, from the self-hosted Barlow Condensed TTFs (src/assets/fonts/), and writes:
 *
 *   functions/_lib/atlas.json  metrics: advance widths and kerning (font units), and per strike
 *                              (weight + pixel size) the glyph boxes into atlas.bin
 *   functions/_lib/atlas.bin   coverage masks, run-length encoded per row (format below)
 *
 * Outlines come from opentype.js (with GPOS kerning); each outline is rasterized with
 * @resvg/resvg-js, the same rasterizer as the build-time team OG images, so both kinds of image
 * have identical anti-aliasing. Small sizes are rendered at several horizontal sub-pixel phases so
 * letter spacing stays even when glyphs are placed on the integer pixel grid.
 *
 * Mask format: per glyph row, a sequence of tokens; token byte t: type = t >> 6, n = (t & 63) + 1.
 *   type 0: skip n transparent pixels   type 1: n fully covered pixels
 *   type 2: n partial pixels, followed by their n coverage bytes (1..254)
 *   type 3: end of row (trailing transparent pixels are implicit)
 * Interiors become one native fill and only anti-aliased edges are blended, which keeps the
 * renderer fast even before the JIT warms up (the first request of a new isolate).
 *
 * Output is deterministic; both files are committed. Re-run after changing the fonts, the sizes in
 * DESIGN.md §16, or the character sets below:
 *
 *   npm run fn:atlas            (node scripts/fn-build-atlas.mjs)
 *   node scripts/fn-build-atlas.mjs --check   exit 1 if the committed atlas is out of date
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import opentype from 'opentype.js';
import { Resvg } from '@resvg/resvg-js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_JSON = join(root, 'functions/_lib/atlas.json');
const OUT_BIN = join(root, 'functions/_lib/atlas.bin');
const FONT = { 600: 'src/assets/fonts/BarlowCondensed-600.ttf', 700: 'src/assets/fonts/BarlowCondensed-700.ttf' };

const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const DIGITS = '0123456789';
// School names in caps: Latin-1 capitals cover every FBS name (e.g. SAN JOSÉ STATE) with room to spare.
const NAME = `${UPPER}${DIGITS} &'()-.,/:ÀÁÂÄÃÅÇÈÉÊËÌÍÎÏÑÒÓÔÖÕÙÚÛÜÝ’ʻ`;
const KICKER = `${UPPER}${DIGITS} ·-–.,:/&'#`;

/**
 * Strikes = (weight, px size) pairs from DESIGN.md §16 "Share image". `phases` = sub-pixel
 * positions per pixel (1 for large text, where a 0.5 px rounding is invisible).
 */
const STRIKES = [
  { weight: 700, size: 76, phases: 1, chars: `${UPPER}${DIGITS} -` }, // "MY TOP 12"
  { weight: 700, size: 40, phases: 2, chars: DIGITS }, // seed plates
  ...[34, 32, 30, 28, 26].map((size) => ({ weight: 700, size, phases: 4, chars: NAME })), // team names (34, shrink to 26)
  { weight: 600, size: 30, phases: 4, chars: KICKER }, // "AFTER WEEK 9 · 2026", records "8-0"
  { weight: 600, size: 28, phases: 4, chars: `${UPPER}${LOWER}${DIGITS} .,'-·!?` }, // tagline
  { weight: 600, size: 26, phases: 4, chars: KICKER }, // "CFBBLINDRESUME.COM · RATINGS: FEI BY BRIAN FREMEAU"
];

const PAD = 4;

function loadFont(file) {
  const buf = readFileSync(join(root, file));
  return opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

/** Rasterize one glyph outline; returns its trimmed coverage box relative to the integer pen/baseline. */
function rasterize(font, ch, size, phase) {
  const glyph = font.charToGlyph(ch);
  const scale = size / font.unitsPerEm;
  const bb = glyph.getBoundingBox();
  const empty = !glyph.path || glyph.path.commands.length === 0 || bb.x2 <= bb.x1;
  if (empty) return { bx: 0, by: 0, w: 0, h: 0, data: new Uint8Array(0) };
  const left = Math.floor(bb.x1 * scale) - PAD;
  const top = Math.floor(-bb.y2 * scale) - PAD;
  const w = Math.ceil(bb.x2 * scale) - left + PAD + 1;
  const h = Math.ceil(-bb.y1 * scale) - top + PAD + 1;
  // Pen at (phase - left, -top) in canvas pixels: canvas (0,0) = (left, top) relative to pen/baseline.
  const d = glyph.getPath(phase - left, -top, size).toPathData(3);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><path d="${d}" fill="#fff"/></svg>`;
  const img = new Resvg(svg, { font: { loadSystemFonts: false } }).render();
  const px = img.pixels;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (px[(y * w + x) * 4 + 3]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return { bx: 0, by: 0, w: 0, h: 0, data: new Uint8Array(0) };
  const tw = x1 - x0 + 1;
  const th = y1 - y0 + 1;
  const rows = [];
  for (let y = 0; y < th; y++) {
    const row = [];
    for (let x = 0; x < tw; x++) row.push(px[((y0 + y) * w + x0 + x) * 4 + 3]);
    rows.push(row);
  }
  return { bx: left + x0, by: top + y0, w: tw, h: th, data: encodeRows(rows) };
}

/** Run-length encode coverage rows (format in the header comment). */
export function encodeRows(rows) {
  const out = [];
  const kind = (a) => (a === 0 ? 0 : a === 255 ? 1 : 2);
  for (const row of rows) {
    let end = row.length;
    while (end > 0 && row[end - 1] === 0) end--;
    let x = 0;
    while (x < end) {
      const k = kind(row[x]);
      let n = 1;
      while (x + n < end && n < 64 && kind(row[x + n]) === k) n++;
      out.push((k << 6) | (n - 1));
      if (k === 2) for (let i = 0; i < n; i++) out.push(row[x + i]);
      x += n;
    }
    out.push(0xc0);
  }
  return Uint8Array.from(out);
}

function build() {
  const fonts = { 600: loadFont(FONT[600]), 700: loadFont(FONT[700]) };
  const upm = fonts[700].unitsPerEm;
  if (fonts[600].unitsPerEm !== upm) throw new Error('fn-build-atlas: weights differ in unitsPerEm');

  // Per weight: the union of the strikes' characters, advance widths and non-zero kerning pairs.
  const metrics = {};
  for (const weight of [600, 700]) {
    const font = fonts[weight];
    const chars = [...new Set(STRIKES.filter((s) => s.weight === weight).flatMap((s) => [...s.chars]))].sort().join('');
    const glyphs = [...chars].map((c) => {
      const g = font.charToGlyph(c);
      if (!g || g.index === 0) throw new Error(`fn-build-atlas: ${weight} has no glyph for ${JSON.stringify(c)}`);
      return g;
    });
    const adv = glyphs.map((g) => g.advanceWidth);
    const kern = [];
    for (let i = 0; i < glyphs.length; i++) {
      for (let j = 0; j < glyphs.length; j++) {
        const k = font.getKerningValue(glyphs[i], glyphs[j]);
        if (k) kern.push(i, j, k);
      }
    }
    metrics[weight] = { chars, adv, kern };
  }

  const chunks = [];
  let offset = 0;
  const strikes = STRIKES.map((s) => {
    const font = fonts[s.weight];
    const g = [];
    for (const ch of s.chars) {
      for (let p = 0; p < s.phases; p++) {
        const r = rasterize(font, ch, s.size, p / s.phases);
        g.push(r.bx, r.by, r.w, r.h, offset);
        chunks.push(r.data);
        offset += r.data.length;
      }
    }
    return { weight: s.weight, size: s.size, phases: s.phases, chars: s.chars, g };
  });

  const bin = new Uint8Array(offset);
  let o = 0;
  for (const c of chunks) {
    bin.set(c, o);
    o += c.length;
  }
  const json = {
    v: 1,
    font: 'Barlow Condensed (SIL OFL 1.1, see src/assets/fonts/OFL.txt)',
    note: 'Generated by scripts/fn-build-atlas.mjs. Do not edit.',
    upm,
    bytes: bin.length,
    sha256: createHash('sha256').update(bin).digest('hex'),
    metrics,
    strikes,
  };
  return { json: `${JSON.stringify(json)}\n`, bin };
}

const t0 = performance.now();
const { json, bin } = build();
if (process.argv.includes('--check')) {
  const same = existsSync(OUT_JSON) && existsSync(OUT_BIN) && readFileSync(OUT_JSON, 'utf8') === json && Buffer.compare(readFileSync(OUT_BIN), Buffer.from(bin)) === 0;
  if (!same) {
    console.error('fn-build-atlas: functions/_lib/atlas.{json,bin} are out of date; run `npm run fn:atlas`.');
    process.exit(1);
  }
  console.log('fn-build-atlas: atlas is up to date.');
} else {
  writeFileSync(OUT_JSON, json);
  writeFileSync(OUT_BIN, bin);
  console.log(`fn-build-atlas: ${STRIKES.length} strikes, ${(bin.length / 1024).toFixed(0)} KiB masks, ${(json.length / 1024).toFixed(0)} KiB metrics in ${(performance.now() - t0).toFixed(0)} ms`);
}
