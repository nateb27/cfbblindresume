/**
 * Glyph atlas runtime: text measurement (advance widths + GPOS kerning) and per-glyph coverage
 * masks for the share-image renderer. The data is produced at build time by
 * scripts/fn-build-atlas.mjs (atlas.json metrics + atlas.bin masks); this module only indexes it.
 */

export type Weight = 600 | 700;

/** atlas.json as written by scripts/fn-build-atlas.mjs. */
export interface AtlasJson {
  v: number;
  upm: number;
  bytes: number;
  metrics: Record<string, { chars: string; adv: number[]; kern: number[] }>;
  strikes: { weight: number; size: number; phases: number; chars: string; g: number[] }[];
}

/** One rasterized glyph: box relative to the integer pen position and baseline. */
export interface GlyphMask {
  bx: number;
  by: number;
  w: number;
  h: number;
  offset: number;
}

interface FontMetrics {
  index: Map<string, number>;
  adv: number[];
  kern: Map<number, number>;
}

interface Strike {
  weight: Weight;
  size: number;
  phases: number;
  /** char -> first glyph entry (phases consecutive entries). */
  index: Map<string, number>;
  glyphs: GlyphMask[];
}

/** A positioned glyph of a laid-out line. */
export interface PlacedGlyph {
  mask: GlyphMask;
  /** Integer pen x for the mask (the phase is baked into the mask). */
  x: number;
}

export interface Atlas {
  upm: number;
  data: Uint8Array;
  fonts: Record<Weight, FontMetrics>;
  strikes: Strike[];
}

const KEY = 4096;

/** Index atlas.json + atlas.bin once per isolate. */
export function loadAtlas(json: AtlasJson, bin: ArrayBuffer | Uint8Array): Atlas {
  const data = bin instanceof Uint8Array ? bin : new Uint8Array(bin);
  if (data.length !== json.bytes) throw new Error(`atlas: expected ${json.bytes} mask bytes, got ${data.length}`);
  const fonts = {} as Record<Weight, FontMetrics>;
  for (const w of [600, 700] as const) {
    const m = json.metrics[String(w)];
    if (!m) throw new Error(`atlas: no metrics for weight ${w}`);
    const chars = [...m.chars];
    const index = new Map(chars.map((c, i) => [c, i]));
    const kern = new Map<number, number>();
    for (let i = 0; i < m.kern.length; i += 3) kern.set(m.kern[i]! * KEY + m.kern[i + 1]!, m.kern[i + 2]!);
    fonts[w] = { index, adv: m.adv, kern };
  }
  const strikes = json.strikes.map((s): Strike => {
    const glyphs: GlyphMask[] = [];
    for (let i = 0; i < s.g.length; i += 5) glyphs.push({ bx: s.g[i]!, by: s.g[i + 1]!, w: s.g[i + 2]!, h: s.g[i + 3]!, offset: s.g[i + 4]! });
    const index = new Map<string, number>();
    [...s.chars].forEach((c, i) => index.set(c, i * s.phases));
    return { weight: s.weight as Weight, size: s.size, phases: s.phases, index, glyphs };
  });
  return { upm: json.upm, data, fonts, strikes };
}

export function findStrike(atlas: Atlas, weight: Weight, size: number): Strike {
  const s = atlas.strikes.find((x) => x.weight === weight && x.size === size);
  if (!s) throw new Error(`atlas: no ${weight} strike at ${size}px`);
  return s;
}

/** Sizes available for a weight, largest first. */
export function strikeSizes(atlas: Atlas, weight: Weight): number[] {
  return atlas.strikes.filter((s) => s.weight === weight).map((s) => s.size).sort((a, b) => b - a);
}

/**
 * Characters the strike can draw, after a fallback for anything missing: accents are stripped
 * (NFD), curly quotes become straight, and anything still missing becomes a space. Never throws, so
 * a new team name with an unexpected character renders rather than failing the image.
 */
export function drawable(strike: Strike, text: string): string[] {
  const out: string[] = [];
  for (const ch of text) {
    if (strike.index.has(ch)) {
      out.push(ch);
      continue;
    }
    const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (base.length === 1 && strike.index.has(base)) out.push(base);
    else if (/[‘’ʻʼ`]/.test(ch) && strike.index.has("'")) out.push("'");
    else if (/[–—−]/.test(ch) && strike.index.has('-')) out.push('-');
    else out.push(' ');
  }
  return out;
}

/** Pen advance for each char (px, float), including kerning with the next char and tracking. */
function advances(atlas: Atlas, strike: Strike, chars: string[], tracking: number): number[] {
  const f = atlas.fonts[strike.weight];
  const scale = strike.size / atlas.upm;
  return chars.map((c, i) => {
    const a = f.index.get(c);
    let units = a === undefined ? 0 : f.adv[a]!;
    const next = chars[i + 1];
    if (a !== undefined && next !== undefined) {
      const b = f.index.get(next);
      if (b !== undefined) units += f.kern.get(a * KEY + b) ?? 0;
    }
    return units * scale + (next === undefined ? 0 : tracking);
  });
}

/** Width in px of a line (no trailing tracking, so right alignment hits the last glyph's advance). */
export function measure(atlas: Atlas, strike: Strike, text: string, tracking = 0): number {
  return advances(atlas, strike, drawable(strike, text), tracking).reduce((a, b) => a + b, 0);
}

/** Lay out a line from pen x (float); each glyph snaps to the nearest sub-pixel phase. */
export function layout(atlas: Atlas, strike: Strike, text: string, x: number, tracking = 0): PlacedGlyph[] {
  const chars = drawable(strike, text);
  const adv = advances(atlas, strike, chars, tracking);
  const out: PlacedGlyph[] = [];
  let pen = x;
  for (let i = 0; i < chars.length; i++) {
    const base = strike.index.get(chars[i]!);
    if (base !== undefined) {
      let ix = Math.floor(pen);
      let phase = Math.round((pen - ix) * strike.phases);
      if (phase === strike.phases) {
        ix += 1;
        phase = 0;
      }
      const mask = strike.glyphs[base + phase]!;
      if (mask.w > 0) out.push({ mask, x: ix });
    }
    pen += adv[i]!;
  }
  return out;
}

/**
 * Largest strike of `weight` (from `max` down to `min`) whose width fits `maxWidth`, or the smallest
 * one with `fits: false`.
 */
export function fitStrike(atlas: Atlas, weight: Weight, text: string, maxWidth: number, max: number, min: number, tracking = 0): { strike: Strike; width: number; fits: boolean } {
  const sizes = strikeSizes(atlas, weight).filter((s) => s <= max && s >= min);
  let last: { strike: Strike; width: number; fits: boolean } | null = null;
  for (const size of sizes) {
    const strike = findStrike(atlas, weight, size);
    const width = measure(atlas, strike, text, tracking);
    last = { strike, width, fits: width <= maxWidth };
    if (last.fits) return last;
  }
  if (!last) throw new Error(`atlas: no ${weight} strike between ${min} and ${max}px`);
  return last;
}
