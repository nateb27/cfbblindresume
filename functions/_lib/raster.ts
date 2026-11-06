/**
 * A tiny indexed-color (palette) canvas for the share image: solid rectangles plus anti-aliased
 * text from the glyph atlas. Pixels are palette indices stored directly in PNG scanline layout
 * (one filter byte, then `width` bytes per row), so encoding needs no copy.
 *
 * Text coverage is quantized to `levels` steps and blended over the background in sRGB space (the
 * same arithmetic resvg uses); each blend becomes a palette entry, and callers pick `levels` so
 * the palette stays within 256 entries (`levelsFor`). Glyph masks are run-length encoded (see
 * scripts/fn-build-atlas.mjs): covered interiors are native fills, only edges are blended.
 *
 * The canvas also records which rows may differ from the row above. `finishScanlines()` turns
 * every other row into an all-zero PNG "Up" row, which zlib compresses almost for free.
 */
import type { PlacedGlyph } from './atlas';

export const MAX_PALETTE = 256;

/** "#rrggbb" -> 0xRRGGBB. */
export function hexToInt(hex: string): number {
  const h = hex.replace(/^#/, '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  if (!/^[0-9a-f]{6}$/i.test(full)) throw new RangeError(`raster: not a hex color: ${hex}`);
  return parseInt(full, 16);
}

/**
 * The most coverage levels (2..16) such that `base` solid colors plus `combos` distinct
 * (background, ink) text pairs, each needing `levels - 1` blended colors, fit in the palette.
 */
export function levelsFor(base: number, combos: number): number {
  if (combos <= 0) return 16;
  const room = Math.floor((MAX_PALETTE - base) / combos);
  return Math.max(2, Math.min(16, room + 1));
}

export class IndexedCanvas {
  readonly width: number;
  readonly height: number;
  readonly stride: number;
  /** PNG raw scanlines: filter byte + palette indices per row. */
  readonly raw: Uint8Array;
  /** Palette as 0xRRGGBB. */
  readonly palette: number[] = [];
  /** 1 where a row may differ from the row above it. */
  readonly changed: Uint8Array;
  private _levels = 16;
  private qOf = new Uint8Array(256);
  private readonly lookup = new Map<number, number>();
  private readonly mixes = new Map<number, number>();
  /** For blended palette entries: background index, ink index and level (-1 for solid colors). */
  private readonly blendBg = new Int16Array(MAX_PALETTE).fill(-1);
  private readonly blendInk = new Int16Array(MAX_PALETTE).fill(-1);
  private readonly blendQ = new Uint8Array(MAX_PALETTE);
  private finished = false;

  constructor(width: number, height: number, background: string) {
    this.width = width;
    this.height = height;
    this.stride = width + 1;
    this.raw = new Uint8Array(this.stride * height);
    this.changed = new Uint8Array(height);
    this.changed[0] = 1;
    this.levels = 16;
    const bg = this.color(background);
    if (bg !== 0) this.fillRect(0, 0, width, height, bg);
  }

  /** Coverage steps for text (2..16); set before drawing text. */
  get levels(): number {
    return this._levels;
  }

  set levels(L: number) {
    this._levels = Math.max(2, Math.min(16, Math.round(L)));
    for (let a = 0; a < 256; a++) this.qOf[a] = ((a * this._levels + 127) / 255) | 0;
  }

  /** Palette index for a color (added on first use; nearest existing color once the palette is full). */
  color(c: string | number): number {
    const rgb = typeof c === 'number' ? c : hexToInt(c);
    const hit = this.lookup.get(rgb);
    if (hit !== undefined) return hit;
    if (this.palette.length < MAX_PALETTE) {
      const i = this.palette.length;
      this.palette.push(rgb);
      this.lookup.set(rgb, i);
      return i;
    }
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < this.palette.length; i++) {
      const p = this.palette[i]!;
      const dr = ((p >> 16) & 255) - ((rgb >> 16) & 255);
      const dg = ((p >> 8) & 255) - ((rgb >> 8) & 255);
      const db = (p & 255) - (rgb & 255);
      const d = dr * dr + dg * dg + db * db;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  /** Solid rectangle (integer pixel edges; clipped to the canvas). */
  fillRect(x: number, y: number, w: number, h: number, index: number): void {
    const x0 = Math.max(0, Math.round(x));
    const x1 = Math.min(this.width, Math.round(x + w));
    const y0 = Math.max(0, Math.round(y));
    const y1 = Math.min(this.height, Math.round(y + h));
    if (x1 <= x0 || y1 <= y0) return;
    for (let row = y0; row < y1; row++) {
      const o = row * this.stride + 1;
      this.raw.fill(index, o + x0, o + x1);
    }
    this.changed[y0] = 1;
    if (y1 < this.height) this.changed[y1] = 1;
  }

  /** 1px outline just inside a rectangle. */
  strokeRect(x: number, y: number, w: number, h: number, index: number): void {
    this.fillRect(x, y, w, 1, index);
    this.fillRect(x, y + h - 1, w, 1, index);
    this.fillRect(x, y, 1, h, index);
    this.fillRect(x + w - 1, y, 1, h, index);
  }

  /** Palette index of `bg` blended toward `ink` at q / levels. */
  private mix(bg: number, ink: number, q: number): number {
    const key = (bg * MAX_PALETTE + ink) * 32 + q;
    const hit = this.mixes.get(key);
    if (hit !== undefined) return hit;
    const a = this.palette[bg]!;
    const b = this.palette[ink]!;
    const t = q / this._levels;
    const ch = (s: number): number => {
      const ca = (a >> s) & 255;
      return Math.round(ca + (((b >> s) & 255) - ca) * t);
    };
    const i = this.color((ch(16) << 16) | (ch(8) << 8) | ch(0));
    if (this.blendInk[i] === -1 && !(i === bg || i === ink)) {
      this.blendBg[i] = bg;
      this.blendInk[i] = ink;
      this.blendQ[i] = q;
    }
    this.mixes.set(key, i);
    return i;
  }

  /**
   * Draw a laid-out line in palette color `ink` over solid background `bg` (palette indices).
   * Where two glyphs' anti-aliased edges share a pixel, their coverage adds up (as when the whole
   * line is rasterized as one shape); pixels over anything other than `bg` blend over what is there.
   */
  drawGlyphs(glyphs: PlacedGlyph[], baseline: number, ink: number, masks: Uint8Array, bg = -1): void {
    const raw = this.raw;
    const qOf = this.qOf;
    const L = this._levels;
    const W = this.width;
    const H = this.height;
    const stride = this.stride;
    const blendInk = this.blendInk;
    const blendQ = this.blendQ;
    // Fast path: blends of bg -> ink by level, precomputed once per line (index L = ink itself).
    const fast = new Int16Array(L + 1).fill(-1);
    if (bg >= 0) {
      for (let q = 1; q < L; q++) fast[q] = this.mix(bg, ink, q);
      fast[L] = ink;
    }
    for (let gi = 0; gi < glyphs.length; gi++) {
      const g = glyphs[gi]!;
      const m = g.mask;
      let p = m.offset;
      const y0 = baseline + m.by;
      const x0 = g.x + m.bx;
      const h = m.h;
      const clipX = x0 < 0 || x0 + m.w > W;
      for (let r = 0; r < h; r++) {
        const y = y0 + r;
        const visible = y >= 0 && y < H;
        const o = y * stride + 1;
        let x = x0;
        for (;;) {
          const t = masks[p++]!;
          const type = t >> 6;
          if (type === 3) break;
          const n = (t & 63) + 1;
          if (type === 0) {
            x += n;
          } else if (type === 1) {
            if (visible) {
              if (!clipX) raw.fill(ink, o + x, o + x + n);
              else {
                const a = x < 0 ? 0 : x;
                const b = x + n > W ? W : x + n;
                if (b > a) raw.fill(ink, o + a, o + b);
              }
            }
            x += n;
          } else {
            const end = p + n;
            if (!visible) {
              p = end;
              x += n;
              continue;
            }
            for (; p < end; p++, x++) {
              const q = qOf[masks[p]!]!;
              if (q === 0 || (clipX && (x < 0 || x >= W))) continue;
              const i = o + x;
              const dst = raw[i]!;
              if (dst === bg) {
                raw[i] = fast[q]!;
              } else if (dst !== ink) {
                // Over an edge pixel of the same line (coverage adds) or over another color.
                const same = blendInk[dst] === ink;
                const sum = same ? q + blendQ[dst]! : q;
                raw[i] = sum >= L ? ink : this.mix(same ? this.blendBg[dst]! : dst, ink, sum);
              }
            }
          }
        }
      }
      const yEnd = Math.min(H - 1, y0 + h);
      for (let y = Math.max(0, y0); y <= yEnd; y++) this.changed[y] = 1;
    }
  }

  /**
   * Final pass before encoding: rows identical to the row above become PNG filter 2 (Up) rows of
   * zeros. Call once; the canvas cannot be drawn on afterwards.
   */
  finishScanlines(): Uint8Array {
    if (!this.finished) {
      this.finished = true;
      for (let y = 1; y < this.height; y++) {
        if (this.changed[y]) continue;
        const o = y * this.stride;
        this.raw.fill(0, o, o + this.stride);
        this.raw[o] = 2;
      }
    }
    return this.raw;
  }

  /** Palette index of the pixel at (x, y) (before `finishScanlines`). */
  pixel(x: number, y: number): number {
    return this.raw[y * this.stride + 1 + x]!;
  }

  /** PLTE chunk payload (r, g, b per entry). */
  paletteBytes(): Uint8Array {
    const out = new Uint8Array(this.palette.length * 3);
    this.palette.forEach((c, i) => {
      out[i * 3] = (c >> 16) & 255;
      out[i * 3 + 1] = (c >> 8) & 255;
      out[i * 3 + 2] = c & 255;
    });
    return out;
  }
}
