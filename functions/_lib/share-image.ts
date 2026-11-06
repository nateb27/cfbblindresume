/**
 * The share image for /og/r/{code}.png (DESIGN.md §16 "Share image"): the user's top 12 as
 * lower-third rows (seed plate, team color block with condensed caps name and record, secondary
 * rule), on the dark stage with the accent bar. Rectangles + atlas glyphs only, so it renders in
 * about a millisecond and matches the build-time resvg images.
 *
 * Everything shown comes from the week's game data and the run: names, colors, records, the
 * default format's field size and byes, the week label. Nothing is hard-coded about teams.
 *
 * The hook line (top right, under the kicker) says how the ranking compares, computed from the code
 * alone: "Matched the committee on 43% · Biggest call: Kentucky ▲4" (pairwise agreement, then the
 * top-12 team the ranking places furthest from the committee; the triangle is drawn, in win/loss
 * colors, because the font has none). Without a committee release it reads "Matched FEI on 65%".
 */
import type { AgreementSummary } from '@lib/agreement';
import type { GameData } from '@lib/game-data';
import { defaultFormat } from '@lib/playoff';
import { colors, teamPaint } from '../../src/styles/tokens';
import { findStrike, fitStrike, layout, measure, type Atlas, type Weight } from './atlas';
import { crc32, encodePalettePng } from './png';
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

/** The one-line summary under the kicker (see the file comment). */
export interface ShareHook {
  /** Which ranking the percentage compares with. */
  ref: 'committee' | 'FEI';
  /** Pairwise agreement, "43%". */
  pct: string;
  /**
   * The top-12 team the ranking places furthest from the committee: `delta` = committee rank minus
   * this ranking's (positive = higher than the committee), null when the committee does not rank it.
   * Null when the top 12 matches the committee exactly, or there is no committee.
   */
  call: { name: string; rank: number; delta: number | null } | null;
}

export interface ShareImageModel {
  title: string;
  kicker: string;
  rows: ShareRow[];
  hook?: ShareHook | null;
}

const pct = (share: number | null): string | null => (share === null ? null : `${Math.round(share * 100)}%`);

/**
 * The hook for a ranking: pairwise agreement with the committee (FEI when there is no release) and
 * the biggest call among the first `n` teams. An unranked-by-the-committee team counts as
 * (committee size + 1 − its position) spots; ties go to the higher-placed team.
 */
export function shareHook(gd: GameData, order: readonly string[], agreement: AgreementSummary, n: number): ShareHook | null {
  const committee = gd.committee;
  const cPct = committee && agreement.hasCommittee ? pct(agreement.pairwise.committee.share) : null;
  if (!committee || !cPct) {
    const fPct = pct(agreement.pairwise.fei.share);
    return fPct ? { ref: 'FEI', pct: fPct, call: null } : null;
  }
  const ranked = committee.length;
  let call: ShareHook['call'] = null;
  let best = 0;
  order.slice(0, n).forEach((slug, i) => {
    const t = gd.teams[slug];
    if (!t) return;
    const rank = i + 1;
    const delta = t.committee === null ? null : t.committee - rank;
    const size = delta === null ? ranked + 1 - rank : Math.abs(delta);
    if (size > best) {
      best = size;
      call = { name: t.name, rank, delta };
    }
  });
  return { ref: 'committee', pct: cPct, call };
}

/**
 * What the image shows for a ranking (the user's order) in this week's game data. `byes` = slugs
 * with first-round byes in the default format (RunResults.playoff.byes); without it, the format's
 * top `byes` positions (straight seeding). `agreement` (RunResults.agreement) adds the hook line.
 */
export function shareImageModel(gd: GameData, order: readonly string[], byes?: readonly string[], agreement?: AgreementSummary): ShareImageModel {
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
  const hook = agreement ? shareHook(gd, order, agreement, rows.length) : null;
  return { title: `My top ${rows.length}`, kicker: `${gd.label} · ${gd.season}`, rows, hook };
}

/** A hook segment: text in one ink, or the drawn delta triangle. */
type HookSeg = { text: string; ink: string } | { tri: 'up' | 'down' };

const HOOK_SIZE = 28;
const HOOK_TRACKING = 0.3;
const TRI = Object.freeze({ w: 15, h: 13, gap: 5 });

/** Hook wordings, longest first; the first that fits the space beside the title is drawn. */
function hookCandidates(h: ShareHook): HookSeg[][] {
  const muted = D['fg-muted'];
  const lead = (on: boolean): HookSeg[] => [
    { text: `Matched ${h.ref === 'committee' ? 'the committee' : 'FEI'}${on ? ' on ' : ' '}`, ink: muted },
    { text: h.pct, ink: D.accent },
  ];
  const c = h.call;
  if (!c) return [lead(true), lead(false)];
  const call: HookSeg[][] =
    c.delta === null
      ? [
          [{ text: c.name, ink: D.fg }, { text: ', unranked by the committee', ink: muted }],
          [{ text: c.name, ink: D.fg }, { text: ' (committee NR)', ink: muted }],
        ]
      : [[{ text: c.name, ink: D.fg }, { tri: c.delta > 0 ? 'up' : 'down' }, { text: String(Math.abs(c.delta)), ink: D.fg }]];
  return [
    ...call.map((x) => [...lead(true), { text: ' · Biggest call: ', ink: muted }, ...x]),
    ...call.map((x) => [...lead(false), { text: ' · ', ink: muted }, ...x]),
    lead(true),
    lead(false),
  ];
}

function hookWidth(atlas: Atlas, segs: HookSeg[]): number {
  const strike = findStrike(atlas, 600, HOOK_SIZE);
  let w = 0;
  for (const seg of segs) w += 'tri' in seg ? TRI.w + 2 * TRI.gap : measure(atlas, strike, seg.text, HOOK_TRACKING);
  return w;
}

/** The hook as ops, right-aligned at `right`, baseline `baseline`; nothing when no wording fits `maxW`. */
function hookOps(h: ShareHook, atlas: Atlas, right: number, baseline: number, maxW: number): Op[] {
  const segs = hookCandidates(h).find((c) => hookWidth(atlas, c) <= maxW);
  if (!segs) return [];
  const strike = findStrike(atlas, 600, HOOK_SIZE);
  const ops: Op[] = [];
  let x = right - hookWidth(atlas, segs);
  for (const seg of segs) {
    if ('tri' in seg) {
      // An isosceles triangle as rows of odd width (crisp, centered), sitting on the cap height band.
      const color = seg.tri === 'up' ? D.win : D.loss;
      const left = Math.round(x + TRI.gap);
      const top = baseline - 2 - TRI.h;
      for (let r = 0; r < TRI.h; r++) {
        const fromTip = seg.tri === 'up' ? r : TRI.h - 1 - r;
        const half = Math.round(((fromTip + 1) / TRI.h) * ((TRI.w - 1) / 2));
        ops.push({ kind: 'rect', x: left + (TRI.w - 1) / 2 - half, y: top + r, w: 2 * half + 1, h: 1, color });
      }
      x += TRI.w + 2 * TRI.gap;
    } else {
      ops.push({ kind: 'text', text: seg.text, x, baseline, weight: 600, size: HOOK_SIZE, tracking: HOOK_TRACKING, align: 'start', ink: seg.ink, bg: D.page });
      x += measure(atlas, strike, seg.text, HOOK_TRACKING);
    }
  }
  return ops;
}

function shareOps(m: ShareImageModel, atlas: Atlas): Op[] {
  const S = SHARE;
  const colW = (S.width - 2 * S.pad - S.colGap) / 2;
  const title = m.title.toUpperCase();
  // With a hook the kicker moves up to the title's cap line and the hook sits on its baseline.
  const hook = m.hook ? hookOps(m.hook, atlas, S.width - S.pad, 104, S.width - 2 * S.pad - measure(atlas, findStrike(atlas, 700, 76), title, 1) - 40) : [];
  const ops: Op[] = [
    { kind: 'rect', x: 0, y: 0, w: S.width, h: S.accentBar, color: D['accent-fill'] },
    { kind: 'text', text: title, x: S.pad, baseline: 104, weight: 700, size: 76, tracking: 1, align: 'start', ink: D.fg, bg: D.page },
    { kind: 'text', text: m.kicker.toUpperCase(), x: S.width - S.pad, baseline: hook.length ? 66 : 102, weight: 600, size: 30, tracking: 2, align: 'end', ink: D['fg-muted'], bg: D.page },
    ...hook,
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
  return paint(shareOps(model, atlas), atlas);
}

/** The share image as PNG bytes. */
export async function renderShareImage(model: ShareImageModel, atlas: Atlas): Promise<Uint8Array> {
  return toPng(paintShareImage(model, atlas));
}

/** A generic branded 1200x630 PNG (last-resort default when /og/default.png is unavailable). */
export async function renderBrandImage(atlas: Atlas): Promise<Uint8Array> {
  return toPng(paint(brandOps(), atlas));
}

/**
 * Warm-up for a fresh isolate: index the atlas and paint one synthetic 12-row image (same layout,
 * fitting and glyph-blending code as a real render), then CRC its scanlines. Run at module scope by
 * the /og/r route, so this one-time JIT and atlas cost is paid at isolate startup (which Workers
 * overlap with the TLS handshake and limit separately) instead of inside the first image request's
 * 10 ms CPU budget. Synchronous and side-effect free; returns a checksum so nothing is optimized away.
 */
export function warmShareRenderer(atlas: Atlas): number {
  const names = ['Mississippi State', 'Florida International', 'UL Monroe', 'Texas A&M', "Hawai'i", 'San José State'];
  const palette = [
    ['#5e0a1c', '#c8c8c8'],
    ['#081e3f', '#c99700'],
    ['#ffffff', '#1b1b1b'],
    ['#ffc72c', '#000000'],
  ] as const;
  const rows: ShareRow[] = Array.from({ length: SHARE.perColumn * 2 }, (_, i) => {
    const [primary, secondary] = palette[i % palette.length]!;
    const name = names[i % names.length]!;
    return { rank: i + 1, name, short: name.slice(0, 8), record: `${9 - (i % 4)}-${i % 3}`, colors: { primary, secondary }, bye: i < 4 };
  });
  const hook: ShareHook = { ref: 'committee', pct: '43%', call: { name: names[0]!, rank: 3, delta: 4 } };
  const canvas = paint(shareOps({ title: 'My top 12', kicker: 'After Week 1 · 2000', rows, hook }, atlas), atlas);
  const raw = canvas.finishScanlines();
  return crc32(raw.subarray(0, 1 << 16)) ^ crc32(canvas.paletteBytes());
}

/** Alt text for the share image (og:image:alt). */
export function shareImageAlt(model: ShareImageModel): string {
  const list = model.rows.map((r) => `${r.rank} ${r.name}`).join(', ');
  return `${model.title} of a blind-resume college football ranking, ${model.kicker}: ${list}.${hookAlt(model.hook)} Ratings: FEI by Brian Fremeau.`;
}

/** " Matched the committee on 43%; biggest call: Kentucky, 4 spots above the committee." */
function hookAlt(h: ShareHook | null | undefined): string {
  if (!h) return '';
  const lead = ` Matched ${h.ref === 'committee' ? 'the committee' : 'FEI'} on ${h.pct}`;
  const c = h.call;
  if (!c) return `${lead}.`;
  if (c.delta === null) return `${lead}; biggest call: ${c.name} at No. ${c.rank}, unranked by the committee.`;
  const n = Math.abs(c.delta);
  return `${lead}; biggest call: ${c.name}, ${n} ${n === 1 ? 'spot' : 'spots'} ${c.delta > 0 ? 'above' : 'below'} the committee.`;
}
