/**
 * The share image for /og/r/{code}.png (DESIGN.md §16 "Share image"): the user's top 12 as
 * lower-third rows (seed plate, team color block with condensed caps name and record, secondary
 * rule), on the dark stage with the accent bar. Rectangles + atlas glyphs only, so it renders in
 * about a millisecond and matches the build-time resvg images.
 *
 * Everything shown comes from the week's game data and the run: names, colors, records, the
 * default format's field size and byes, the week label. Nothing is hard-coded about teams.
 */
import type { GameData } from '@lib/game-data';
import { defaultFormat } from '@lib/playoff';
import { colors, teamPaint } from '../../src/styles/tokens';
import { findStrike, fitStrike, layout, measure, type Atlas, type Weight } from './atlas';
import { encodePalettePng } from './png';
import { IndexedCanvas, levelsFor } from './raster';

const D = colors.dark;

/** Geometry (px). Matches the reference render in DESIGN.md §16. */
export const SHARE = Object.freeze({
  width: 1200,
  height: 630,
  pad: 56,
  colGap: 32,
  rowH: 60,
  rowGap: 12,
  top: 140,
  plate: 64,
  rule: 6,
  accentBar: 8,
  perColumn: 6,
});

const BRAND = 'CFBBLINDRESUME.COM · RATINGS: FEI BY BRIAN FREMEAU';
const TAGLINE = 'Same game. Different numbers.';

type Align = 'start' | 'end' | 'middle';

interface RectOp {
  kind: 'rect' | 'stroke';
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
}

interface TextOp {
  kind: 'text';
  text: string;
  x: number;
  baseline: number;
  weight: Weight;
  /** Fixed size, or a [max, min] range to shrink within `maxWidth` (2px steps, the atlas strikes). */
  size: number | [number, number];
  maxWidth?: number;
  /** Shorter text to use when `text` does not fit at the smallest size. */
  fallback?: string;
  tracking: number;
  align: Align;
  ink: string;
  /** The solid color under the text (for the palette budget). */
  bg: string;
}

type Op = RectOp | TextOp;

/** One row of the image. */
export interface ShareRow {
  rank: number;
  name: string;
  short: string;
  record: string;
  colors: { primary: string; secondary: string };
  bye: boolean;
}

export interface ShareImageModel {
  title: string;
  kicker: string;
  rows: ShareRow[];
}

/**
 * What the image shows for a ranking (the user's order) in this week's game data. `byes` = slugs
 * with first-round byes in the default format (RunResults.playoff.byes); without it, the format's
 * top `byes` positions (straight seeding).
 */
export function shareImageModel(gd: GameData, order: readonly string[], byes?: readonly string[]): ShareImageModel {
  const fmt = defaultFormat(gd.playoffFormats);
  const n = Math.min(fmt.size, SHARE.perColumn * 2);
  const byeSet = byes ? new Set(byes) : null;
  const rows = order.slice(0, n).map((slug, i): ShareRow => {
    const t = gd.teams[slug];
    if (!t) throw new RangeError(`share image: ${slug} is not in the week's teams`);
    return {
      rank: i + 1,
      name: t.name,
      short: t.short,
      record: `${t.record.w}-${t.record.l}`,
      colors: t.colors,
      bye: byeSet ? byeSet.has(slug) : i < fmt.byes,
    };
  });
  return { title: `My top ${rows.length}`, kicker: `${gd.label} · ${gd.season}`, rows };
}

function shareOps(m: ShareImageModel): Op[] {
  const S = SHARE;
  const colW = (S.width - 2 * S.pad - S.colGap) / 2;
  const ops: Op[] = [
    { kind: 'rect', x: 0, y: 0, w: S.width, h: S.accentBar, color: D['accent-fill'] },
    { kind: 'text', text: m.title.toUpperCase(), x: S.pad, baseline: 104, weight: 700, size: 76, tracking: 1, align: 'start', ink: D.fg, bg: D.page },
    { kind: 'text', text: m.kicker.toUpperCase(), x: S.width - S.pad, baseline: 102, weight: 600, size: 30, tracking: 2, align: 'end', ink: D['fg-muted'], bg: D.page },
  ];
  m.rows.forEach((r, i) => {
    const col = Math.floor(i / S.perColumn);
    const x = S.pad + col * (colW + S.colGap);
    const y = S.top + (i % S.perColumn) * (S.rowH + S.rowGap);
    const p = teamPaint(r.colors);
    const plateBg = r.bye ? D['accent-fill'] : D['raised-2'];
    const plateInk = r.bye ? D['on-accent'] : D.fg;
    const bx = x + S.plate;
    const bw = colW - S.plate;
    ops.push(
      { kind: 'rect', x, y, w: S.plate, h: S.rowH, color: plateBg },
      { kind: 'text', text: String(r.rank), x: x + S.plate / 2, baseline: y + 44, weight: 700, size: 40, tracking: 0, align: 'middle', ink: plateInk, bg: plateBg },
      { kind: 'rect', x: bx, y, w: bw, h: S.rowH, color: p.bg },
    );
    if (p.edge) ops.push({ kind: 'stroke', x: bx, y, w: bw, h: S.rowH - S.rule, color: p.edge });
    ops.push(
      { kind: 'rect', x: bx, y: y + S.rowH - S.rule, w: bw, h: S.rule, color: p.rule },
      {
        kind: 'text',
        text: r.name.toUpperCase(),
        fallback: r.short.toUpperCase(),
        x: bx + 20,
        baseline: y + 42,
        weight: 700,
        size: [34, 26],
        maxWidth: bw - 110,
        tracking: 0.5,
        align: 'start',
        ink: p.ink,
        bg: p.bg,
      },
      { kind: 'text', text: r.record, x: x + colW - 18, baseline: y + 41, weight: 600, size: 30, tracking: 0, align: 'end', ink: p.ink, bg: p.bg },
    );
  });
  ops.push(
    { kind: 'text', text: TAGLINE, x: S.pad, baseline: 600, weight: 600, size: 28, tracking: 0.5, align: 'start', ink: D['fg-muted'], bg: D.page },
    { kind: 'text', text: BRAND, x: S.width - S.pad, baseline: 600, weight: 600, size: 26, tracking: 1.5, align: 'end', ink: D['fg-muted'], bg: D.page },
  );
  return ops;
}

/** Generic card (no ranking): used when a code is invalid and the static default image is missing. */
function brandOps(): Op[] {
  const S = SHARE;
  return [
    { kind: 'rect', x: 0, y: 0, w: S.width, h: S.accentBar, color: D['accent-fill'] },
    { kind: 'text', text: 'CFB BLIND RESUME', x: S.pad, baseline: 300, weight: 700, size: 76, tracking: 1, align: 'start', ink: D.fg, bg: D.page },
    { kind: 'text', text: 'Rank three resumes. No names. Build your own top 25.', x: S.pad, baseline: 352, weight: 600, size: 28, tracking: 0.5, align: 'start', ink: D['fg-muted'], bg: D.page },
    { kind: 'text', text: TAGLINE, x: S.pad, baseline: 600, weight: 600, size: 28, tracking: 0.5, align: 'start', ink: D['fg-muted'], bg: D.page },
    { kind: 'text', text: BRAND, x: S.width - S.pad, baseline: 600, weight: 600, size: 26, tracking: 1.5, align: 'end', ink: D['fg-muted'], bg: D.page },
  ];
}

function paint(ops: Op[], atlas: Atlas): IndexedCanvas {
  const canvas = new IndexedCanvas(SHARE.width, SHARE.height, D.page);
  // Palette budget: every solid color, plus (levels - 1) blends per distinct (background, ink) pair.
  const solids = new Set<string>([D.page.toLowerCase()]);
  const combos = new Set<string>();
  for (const op of ops) {
    if (op.kind === 'text') {
      solids.add(op.ink.toLowerCase());
      solids.add(op.bg.toLowerCase());
      combos.add(`${op.bg.toLowerCase()}>${op.ink.toLowerCase()}`);
    } else solids.add(op.color.toLowerCase());
  }
  canvas.levels = levelsFor(solids.size, combos.size);
  for (const op of ops) {
    if (op.kind !== 'text') {
      if (op.kind === 'rect') canvas.fillRect(op.x, op.y, op.w, op.h, canvas.color(op.color));
      else canvas.strokeRect(op.x, op.y, op.w, op.h, canvas.color(op.color));
    } else {
      let text = op.text;
      let strike;
      let width;
      if (Array.isArray(op.size)) {
        const maxW = op.maxWidth ?? Infinity;
        let fit = fitStrike(atlas, op.weight, text, maxW, op.size[0], op.size[1], op.tracking);
        if (!fit.fits && op.fallback) {
          text = op.fallback;
          fit = fitStrike(atlas, op.weight, text, maxW, op.size[0], op.size[1], op.tracking);
        }
        while (!fit.fits && text.length > 1) {
          text = text.slice(0, -1).trimEnd();
          fit = { ...fit, width: measure(atlas, fit.strike, text, op.tracking) };
          fit.fits = fit.width <= maxW;
        }
        strike = fit.strike;
        width = fit.width;
      } else {
        strike = findStrike(atlas, op.weight, op.size);
        width = measure(atlas, strike, text, op.tracking);
      }
      const x0 = op.align === 'start' ? op.x : op.align === 'end' ? op.x - width : op.x - width / 2;
      canvas.drawGlyphs(layout(atlas, strike, text, x0, op.tracking), op.baseline, canvas.color(op.ink), atlas.data, canvas.color(op.bg));
    }
  }
  return canvas;
}

async function toPng(canvas: IndexedCanvas): Promise<Uint8Array> {
  return encodePalettePng({ width: canvas.width, height: canvas.height, palette: canvas.paletteBytes(), raw: canvas.finishScanlines() });
}

/** Paint the share image (no encoding); exposed for tests and benchmarks. */
export function paintShareImage(model: ShareImageModel, atlas: Atlas): IndexedCanvas {
  return paint(shareOps(model), atlas);
}

/** The share image as PNG bytes. */
export async function renderShareImage(model: ShareImageModel, atlas: Atlas): Promise<Uint8Array> {
  return toPng(paintShareImage(model, atlas));
}

/** A generic branded 1200x630 PNG (last-resort default when /og/default.png is unavailable). */
export async function renderBrandImage(atlas: Atlas): Promise<Uint8Array> {
  return toPng(paint(brandOps(), atlas));
}

/** Alt text for the share image (og:image:alt). */
export function shareImageAlt(model: ShareImageModel): string {
  const list = model.rows.map((r) => `${r.rank} ${r.name}`).join(', ');
  return `${model.title} of a blind-resume college football ranking, ${model.kicker}: ${list}. Ratings: FEI by Brian Fremeau.`;
}
