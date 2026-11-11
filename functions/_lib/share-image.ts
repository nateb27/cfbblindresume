/**
 * The share image for /og/r/{code}.png (DESIGN.md "Share image"): the user's top 12 as a page of
 * the committee file. Paper page, "My top 12" in ink, two columns of index tabs (the seed on a
 * team-colour plate with its secondary rule, the name typed in ink on a sheet, the record and any
 * bye as quiet meta), and the footer band with the wordmark ("Blind" reversed out of a redaction
 * bar) and the FEI credit. Rectangles + atlas glyphs only, so it renders in about a millisecond
 * and matches the build-time resvg images (src/components/og.ts).
 *
 * Everything shown comes from the week's game data and the run: names, colors, records, the
 * default format's field size and byes, the week label. Nothing is hard-coded about teams.
 *
 * The hook line (top right, on the title's baseline) says how the ranking compares, computed from
 * the code alone: "Matched the committee on 43% · Biggest call: Kentucky ▲4" (pairwise agreement in
 * violet, the fan's own number; then the top-12 team the ranking places furthest from the
 * committee; the triangle is drawn, in win/loss colors, because the font has none). Without a
 * committee release it reads "Matched FEI on 65%".
 */
import type { AgreementSummary } from '@lib/agreement';
import type { GameData } from '@lib/game-data';
import { defaultFormat } from '@lib/playoff';
import { colors, teamPaint } from '../../src/styles/tokens';
import { findStrike, layout, measure, strikeSizes, type Atlas, type Weight } from './atlas';
import { crc32, encodePalettePng } from './png';
import { IndexedCanvas, levelsFor } from './raster';

/** The paper palette (light sheet), as on every OG image. */
const P = colors.light;

/** Geometry (px). Matches the reference render in DESIGN.md "Share image". */
export const SHARE = Object.freeze({
  width: 1200,
  height: 630,
  pad: 56,
  /** Two columns of index tabs at x 56 and 628. */
  colW: 516,
  colGap: 56,
  rowH: 60,
  /** Row pitch (60px tab + 10px gap). */
  pitch: 70,
  top: 136,
  plate: 64,
  rule: 6,
  perColumn: 6,
  /** Title and hook baseline. */
  titleBase: 104,
  /** Footer band from here to the bottom edge, 2px ink rule on top. */
  footerTop: 558,
});

const CREDIT = 'cfbblindresume.com · Ratings: FEI by Brian Fremeau';
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
  /** Letter spacing in em (x the strike size = px between glyphs). */
  trackEm: number;
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

/** The one-line summary on the title's baseline, right-aligned (see the file comment). */
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

/** A hook segment: text in one weight and ink, or the drawn delta triangle. */
type HookSeg = { text: string; ink: string; weight: Weight } | { tri: 'up' | 'down' };

/** Hook sizes: every wording with the call at 26px, then at 24px, before the call is dropped. */
const HOOK_SIZES = [26, 24] as const;
/** The delta triangle: 15x13, standing on the baseline. */
const TRI = Object.freeze({ w: 15, h: 13, before: 7, after: 4 });

/**
 * Hook wordings with the biggest call, longest first, then the agreement alone. The call keeps the
 * team's full name (short codes like "JXST" would read as noise in sentence case); the wording
 * around it shortens instead.
 */
function hookCandidates(h: ShareHook): { withCall: HookSeg[][]; plain: HookSeg[] } {
  const copy = (text: string): HookSeg => ({ text, ink: P['fg-muted'], weight: 600 });
  const pct: HookSeg = { text: h.pct, ink: P.accent, weight: 800 };
  const full = [copy(`Matched ${h.ref === 'committee' ? 'the committee' : 'FEI'} on `), pct];
  const brief = [copy(`${h.ref === 'committee' ? 'Committee' : 'FEI'} match `), pct];
  const c = h.call;
  if (!c) return { withCall: [], plain: full };
  const name: HookSeg = { text: c.name, ink: P.fg, weight: 800 };
  const calls: HookSeg[][] =
    c.delta === null
      ? [[name, copy(', unranked by the committee')], [name, copy(' (committee NR)')], [name, copy(' (NR)')]]
      : [[name, { tri: c.delta > 0 ? 'up' : 'down' }, { text: String(Math.abs(c.delta)), ink: c.delta > 0 ? P.win : P.loss, weight: 800 }]];
  const label = copy(' · Biggest call: ');
  return { withCall: calls.flatMap((x) => [[...full, label, ...x], [...brief, label, ...x]]), plain: full };
}

function hookWidth(atlas: Atlas, segs: HookSeg[], size: number): number {
  let w = 0;
  for (const seg of segs) w += 'tri' in seg ? TRI.before + TRI.w + TRI.after : measure(atlas, findStrike(atlas, seg.weight, size), seg.text);
  return w;
}

/** The hook as ops, right-aligned at `right` on `baseline`; nothing when no wording fits `maxW`. */
function hookOps(h: ShareHook, atlas: Atlas, right: number, baseline: number, maxW: number): Op[] {
  const { withCall, plain } = hookCandidates(h);
  const tries: [HookSeg[], number][] = [...HOOK_SIZES.flatMap((z) => withCall.map((c): [HookSeg[], number] => [c, z])), ...HOOK_SIZES.map((z): [HookSeg[], number] => [plain, z])];
  const pick = tries.find(([c, z]) => hookWidth(atlas, c, z) <= maxW);
  if (!pick) return [];
  const [segs, size] = pick;
  const ops: Op[] = [];
  let x = right - hookWidth(atlas, segs, size);
  for (const seg of segs) {
    if ('tri' in seg) {
      // An isosceles triangle as rows of odd width (crisp, centered), standing on the baseline.
      const color = seg.tri === 'up' ? P.win : P.loss;
      const left = Math.round(x + TRI.before);
      const top = baseline - TRI.h;
      for (let r = 0; r < TRI.h; r++) {
        const fromTip = seg.tri === 'up' ? r : TRI.h - 1 - r;
        const half = Math.round(((fromTip + 1) / TRI.h) * ((TRI.w - 1) / 2));
        ops.push({ kind: 'rect', x: left + (TRI.w - 1) / 2 - half, y: top + r, w: 2 * half + 1, h: 1, color });
      }
      x += TRI.before + TRI.w + TRI.after;
    } else {
      ops.push({ kind: 'text', text: seg.text, x, baseline, weight: seg.weight, size, trackEm: 0, align: 'start', ink: seg.ink, bg: P.page });
      x += measure(atlas, findStrike(atlas, seg.weight, size), seg.text);
    }
  }
  return ops;
}

/** "CFB [Blind] Resume": Archivo 800, -0.015em, the word reversed out of a redaction bar (og.ts wordmark). */
function wordmarkOps(atlas: Atlas, x: number, baseline: number, size: number, bg: string): Op[] {
  const strike = findStrike(atlas, 800, size);
  const trackEm = -0.015;
  const t = trackEm * size;
  // Widths include the tracking after the last glyph, as resvg spaces the next run.
  const w = (s: string) => measure(atlas, strike, s, t) + t;
  const padX = Math.round(size * 0.16);
  const bx = x + w('CFB ');
  const bw = w('Blind') + 2 * padX;
  const text = (s: string, at: number, ink: string, under: string): TextOp => ({ kind: 'text', text: s, x: at, baseline, weight: 800, size, trackEm, align: 'start', ink, bg: under });
  return [
    text('CFB', x, P.fg, bg),
    { kind: 'rect', x: bx, y: baseline - Math.round(size * 0.84), w: bw, h: Math.round(size * 1.06), color: P.redaction },
    text('Blind', bx + padX, P['on-redaction'], P.redaction),
    text('Resume', bx + bw + w(' '), P.fg, bg),
  ];
}

/** Footer band (DESIGN.md "Common footer"): sheet, 2px ink rule, wordmark left, credit right. */
function footerOps(atlas: Atlas, wordmark = true): Op[] {
  const S = SHARE;
  return [
    { kind: 'rect', x: 0, y: S.footerTop, w: S.width, h: S.height - S.footerTop, color: P.surface },
    { kind: 'rect', x: 0, y: S.footerTop, w: S.width, h: 2, color: P.fg },
    ...(wordmark ? wordmarkOps(atlas, S.pad, 606, 32, P.surface) : []),
    { kind: 'text', text: CREDIT, x: S.width - S.pad, baseline: 604, weight: 600, size: 24, trackEm: 0, align: 'end', ink: P['fg-muted'], bg: P.surface },
  ];
}

function shareOps(m: ShareImageModel, atlas: Atlas): Op[] {
  const S = SHARE;
  const titleTrack = -0.03;
  const titleW = measure(atlas, findStrike(atlas, 800, 76), m.title, titleTrack * 76);
  // The hook sits on the title's baseline, right-aligned; the kicker moves up to the cap line.
  const hook = m.hook ? hookOps(m.hook, atlas, S.width - S.pad, S.titleBase, S.width - 2 * S.pad - titleW - 32) : [];
  const ops: Op[] = [
    { kind: 'text', text: m.title, x: S.pad, baseline: S.titleBase, weight: 800, size: 76, trackEm: titleTrack, align: 'start', ink: P.fg, bg: P.page },
    { kind: 'text', text: m.kicker, x: S.width - S.pad, baseline: hook.length ? 62 : S.titleBase, weight: 600, size: 28, trackEm: 0, align: 'end', ink: P['fg-muted'], bg: P.page },
    ...hook,
  ];
  m.rows.forEach((r, i) => {
    const x = S.pad + Math.floor(i / S.perColumn) * (S.colW + S.colGap);
    const y = S.top + (i % S.perColumn) * S.pitch;
    const p = teamPaint(r.colors);
    // Index tab: the seed on the team colour (+ secondary rule), the name typed on the sheet.
    ops.push(
      { kind: 'rect', x, y, w: S.colW, h: S.rowH, color: P.surface },
      { kind: 'stroke', x, y, w: S.colW, h: S.rowH, color: P['line-strong'] },
      { kind: 'rect', x, y, w: S.plate, h: S.rowH, color: p.bg },
      { kind: 'rect', x, y: y + S.rowH - S.rule, w: S.plate, h: S.rule, color: p.rule },
    );
    if (p.edge) ops.push({ kind: 'stroke', x, y, w: S.plate, h: S.rowH, color: p.edge });
    // Byes are said in words, no colour code.
    const meta = r.bye ? `Bye · ${r.record}` : r.record;
    const metaW = measure(atlas, findStrike(atlas, 600, 26), meta);
    const metaRight = x + S.colW - 18;
    const nameX = x + S.plate + 18;
    ops.push(
      { kind: 'text', text: String(r.rank), x: x + S.plate / 2, baseline: y + 42, weight: 800, size: 36, trackEm: -0.02, align: 'middle', ink: p.ink, bg: p.bg },
      {
        kind: 'text',
        text: r.name,
        fallback: r.short,
        x: nameX,
        baseline: y + 41,
        weight: 800,
        size: [32, 24],
        maxWidth: metaRight - metaW - 24 - nameX,
        trackEm: -0.01,
        align: 'start',
        ink: P.fg,
        bg: P.surface,
      },
      { kind: 'text', text: meta, x: metaRight, baseline: y + 41, weight: 600, size: 26, trackEm: 0, align: 'end', ink: P['fg-muted'], bg: P.surface },
    );
  });
  return [...ops, ...footerOps(atlas)];
}

/** Generic card (no ranking): used when a code is invalid and the static default image is missing. */
function brandOps(atlas: Atlas): Op[] {
  const S = SHARE;
  return [
    ...wordmarkOps(atlas, S.pad, 300, 76, P.page),
    { kind: 'text', text: TAGLINE, x: S.pad, baseline: 356, weight: 600, size: 28, trackEm: 0, align: 'start', ink: P['fg-muted'], bg: P.page },
    ...footerOps(atlas, false),
  ];
}

/** Largest strike of `weight` in [min, max] at which `text` fits `maxW` (tracking scales with size). */
function fitText(atlas: Atlas, weight: Weight, text: string, maxW: number, max: number, min: number, trackEm: number) {
  let last: { strike: ReturnType<typeof findStrike>; width: number; fits: boolean } | null = null;
  for (const size of strikeSizes(atlas, weight)) {
    if (size > max || size < min) continue;
    const strike = findStrike(atlas, weight, size);
    const width = measure(atlas, strike, text, trackEm * size);
    last = { strike, width, fits: width <= maxW };
    if (last.fits) break;
  }
  if (!last) throw new Error(`share image: no ${weight} strike between ${min} and ${max}px`);
  return last;
}

function paint(ops: Op[], atlas: Atlas): IndexedCanvas {
  const canvas = new IndexedCanvas(SHARE.width, SHARE.height, P.page);
  // Palette budget: every solid color, plus (levels - 1) blends per distinct (background, ink) pair.
  const solids = new Set<string>([P.page.toLowerCase()]);
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
        let fit = fitText(atlas, op.weight, text, maxW, op.size[0], op.size[1], op.trackEm);
        if (!fit.fits && op.fallback) {
          text = op.fallback;
          fit = fitText(atlas, op.weight, text, maxW, op.size[0], op.size[1], op.trackEm);
        }
        while (!fit.fits && text.length > 1) {
          text = text.slice(0, -1).trimEnd();
          fit = { ...fit, width: measure(atlas, fit.strike, text, op.trackEm * fit.strike.size) };
          fit.fits = fit.width <= maxW;
        }
        strike = fit.strike;
        width = fit.width;
      } else {
        strike = findStrike(atlas, op.weight, op.size);
        width = measure(atlas, strike, text, op.trackEm * op.size);
      }
      const x0 = op.align === 'start' ? op.x : op.align === 'end' ? op.x - width : op.x - width / 2;
      canvas.drawGlyphs(layout(atlas, strike, text, x0, op.trackEm * strike.size), op.baseline, canvas.color(op.ink), atlas.data, canvas.color(op.bg));
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
  return toPng(paint(brandOps(atlas), atlas));
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
  const hook: ShareHook = { ref: 'committee', pct: '43%', call: { name: names[1]!, rank: 3, delta: null } };
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
