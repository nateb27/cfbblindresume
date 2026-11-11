/**
 * Build-time Open Graph images (DESIGN.md "OG and share images"), rendered with @resvg/resvg-js from
 * rectangles and Archivo glyphs only (the static TTFs in src/assets/fonts). Paper palette
 * (`colors.light`), ink type, toner bars, team colours on covers and index tabs, and the wordmark
 * with "Blind" reversed out of a redaction bar. Node only: used by the prerendered endpoints under
 * src/pages/og/.
 */
import { Resvg } from '@resvg/resvg-js';
import { committeeOrder, gwdOrder } from '@lib/data';
import { rankFill, tierFor } from '@lib/tiers';
import type { WeekFile } from '@lib/types';
import { colors, fonts, og, teamPaint, tierColor } from '../styles/tokens';
import { SITE } from './site';
import { fontFile, textWidth, type FontWeight } from './text-metrics';

const P = colors.light;

/** Largest size <= `size` (2px steps, >= `min`) at which `s` fits in `max` px (tracking in em). */
function fit(s: string, max: number, size: number, min: number, weight: FontWeight = 800, trackEm = 0): number {
  while (size > min && textWidth(s, size, weight, trackEm * size) > max) size -= 2;
  return size;
}

/* ------------------------------------------------------------------ svg primitives */

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function text(
  x: number,
  y: number,
  s: string,
  size: number,
  fill: string,
  opts: { weight?: FontWeight; anchor?: 'start' | 'middle' | 'end'; trackEm?: number } = {},
): string {
  const { weight = 800, anchor = 'start', trackEm = 0 } = opts;
  return `<text x="${x}" y="${y}" font-family="${fonts.family}" font-weight="${weight}" font-size="${size}" fill="${fill}" text-anchor="${anchor}" letter-spacing="${(trackEm * size).toFixed(2)}">${esc(s)}</text>`;
}

const rect = (x: number, y: number, w: number, h: number, fill: string): string =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`;

/** 1px frame drawn as four rectangles (the Worker renderer has no strokes). */
const frame = (x: number, y: number, w: number, h: number, fill: string, t = 1): string =>
  rect(x, y, w, t, fill) + rect(x, y + h - t, w, t, fill) + rect(x, y, t, h, fill) + rect(x + w - t, y, t, h, fill);

const svg = (body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${og.width}" height="${og.height}" viewBox="0 0 ${og.width} ${og.height}">${rect(0, 0, og.width, og.height, P.page)}${body}</svg>`;

/** "CFB [Blind] Resume": Archivo 800, the word reversed out of a redaction bar. Returns svg + width. */
export function wordmark(x: number, baseline: number, size: number): { svg: string; width: number } {
  const t = -0.015;
  const w = (s: string) => textWidth(s, size, 800, t * size);
  const a = 'CFB ';
  const padX = Math.round(size * 0.16);
  const bx = x + w(a);
  const bw = w('Blind') + 2 * padX;
  const top = baseline - Math.round(size * 0.84);
  const h = Math.round(size * 1.06);
  const s =
    text(x, baseline, 'CFB', size, P.fg, { trackEm: t }) +
    rect(bx, top, bw, h, P.redaction) +
    text(bx + padX, baseline, 'Blind', size, P['on-redaction'], { trackEm: t }) +
    text(bx + bw + w(' '), baseline, 'Resume', size, P.fg, { trackEm: t });
  return { svg: s, width: bx + bw + w(' Resume') - x };
}

/** Footer band: sheet, 2px ink rule on top, wordmark left, week + FEI credit right. */
const footer = (week: WeekFile): string =>
  rect(0, og.height - og.footer, og.width, og.footer, P.surface) +
  rect(0, og.height - og.footer, og.width, 2, P.fg) +
  wordmark(og.pad, 606, 32).svg +
  text(og.width - og.pad, 604, `${week.label} · Ratings: FEI by ${week.sources.ratings.author}`, 26, P['fg-muted'], { weight: 600, anchor: 'end' });

/* ------------------------------------------------------------------ images */

/** Team image: the file cover (team colour, name, record), the stat row on paper, footer. */
export function teamOgSvg(week: WeekFile, slug: string): string {
  const t = week.teams[slug];
  if (!t) throw new Error(`og: unknown team ${slug}`);
  const p = teamPaint(t.colors);
  const { width: W, pad } = og;
  const independent = week.playoffFormats.some((f) => f.nonConferences.includes(t.conference));
  const rec = `${t.record.w}-${t.record.l}`;
  const recW = textWidth(rec, 112, 800, -0.02 * 112);
  const nameSize = fit(t.name, W - 2 * pad - recW - 48, 132, 64, 800, -0.025);
  const kicker = independent ? t.conference : `${t.conference} · Conf ${t.confRecord.w}-${t.confRecord.l}`;

  let s = rect(0, 0, W, 300, p.bg);
  if (p.edge) s += frame(0, 0, W, 300, p.edge);
  s += rect(0, 300, W, og.rule, p.rule);
  s += text(pad, 96, kicker, 32, p.ink, { weight: 600 });
  s += text(W - pad, 250, rec, 112, p.ink, { anchor: 'end', trackEm: -0.02 });
  s += text(pad, 250, t.name, nameSize, p.ink, { trackEm: -0.025 });

  const stats: { label: string; rank: number | null }[] = [
    ...(week.committee ? [{ label: 'Committee', rank: t.ranks.committee }] : [{ label: 'FEI overall', rank: t.ranks.fei }]),
    { label: 'Strength of record', rank: t.ranks.sor },
    { label: 'Offense', rank: t.ranks.off },
    { label: 'Defense', rank: t.ranks.def },
    { label: 'Schedule', rank: t.ranks.sos },
  ];
  const cw = (W - 2 * pad) / stats.length;
  const num = (r: number | null) => (r === null ? 'NR' : `#${r}`);
  // One label size and one numeral size for the row (a lone shrunken label or numeral reads as an
  // error): labels the largest <= 26px at which every label fits its cell with a 12px gap
  // ("Strength of record" sets it), numerals the largest <= 84px with at least 44px between them.
  const labelSize = Math.min(...stats.map((st) => fit(st.label, cw - 12, 26, 20, 600)));
  const numSize = Math.min(...stats.map((st) => fit(num(st.rank), cw - 44, 84, 52, 800, -0.02)));
  stats.forEach((st, i) => {
    const x = pad + i * cw;
    s += text(x, 382, st.label, labelSize, P['fg-muted'], { weight: 600 });
    s += text(x, 470, num(st.rank), numSize, P.fg, { trackEm: -0.02 });
    const bw = cw - 28;
    // Every bar, the committee's included, is rankFill in the toner of its rank band, so a #20
    // committee rank never draws a longer bar than a #14 strength of record.
    const f = st.rank === null ? 0 : rankFill(st.rank, week.fbsCount);
    const color = tierColor(tierFor({ fbs: true, feiRank: st.rank ?? week.fbsCount }).stars);
    s += rect(x, 494, bw, 8, P.track);
    if (st.rank !== null) s += rect(x, 494, Math.max(6, Math.round(bw * f)), 8, color);
  });
  return svg(s + footer(week));
}

/**
 * Default site image: the wordmark, tagline, and the week's committee top 5 beside FEI's strength
 * of record top 5 as index tabs (FEI top 5 alone before the first committee release).
 */
export function defaultOgSvg(week: WeekFile): string {
  const { width: W, pad } = og;
  let s = wordmark(pad, 112, 64).svg;
  s += text(pad, 162, SITE.tagline, 32, P['fg-muted'], { weight: 600 });
  s += text(W - pad, 110, `${week.season} season`, 28, P['fg-muted'], { weight: 600, anchor: 'end' });

  const committee = committeeOrder(week);
  const cols: { title: string; order: string[] }[] = [
    ...(committee ? [{ title: 'Committee', order: committee }] : []),
    { title: 'FEI strength of record', order: gwdOrder(week) },
  ];
  const gap = 32;
  const colW = cols.length === 2 ? (W - 2 * pad - gap) / 2 : W - 2 * pad;
  const rowH = 52;
  const rowGap = 10;
  const top = 246;
  cols.forEach((c, ci) => {
    const x = pad + ci * (colW + gap);
    s += text(x, 218, c.title, 24, P['fg-muted'], { weight: 600 });
    s += rect(x, 228, colW, 2, P.fg);
    c.order.slice(0, 5).forEach((slug, i) => {
      const t = week.teams[slug]!;
      const p = teamPaint(t.colors);
      const y = top + i * (rowH + rowGap);
      const plate = 56;
      // index tab: the rank on the team colour (+ secondary rule), the name typed on paper
      s += rect(x, y, colW, rowH, P.surface) + frame(x, y, colW, rowH, P['line-strong']);
      s += rect(x, y, plate, rowH, p.bg) + rect(x, y + rowH - 5, plate, 5, p.rule);
      if (p.edge) s += frame(x, y, plate, rowH, p.edge);
      s += text(x + plate / 2, y + 35, String(i + 1), 30, p.ink, { anchor: 'middle', trackEm: -0.02 });
      s += text(x + plate + 16, y + 35, t.name, fit(t.name, colW - plate - 110, 28, 20, 800, -0.01), P.fg, { trackEm: -0.01 });
      s += text(x + colW - 16, y + 35, `${t.record.w}-${t.record.l}`, 26, P['fg-muted'], { weight: 600, anchor: 'end' });
    });
  });
  return svg(s + footer(week));
}

/**
 * Compare image: the two teams' covers side by side with an ink "vs" plate, then a ratings table
 * on paper (committee, strength of record, offense, defense, schedule): the better rank in ink 800,
 * the other in carbon 600 (weight and colour, never colour alone).
 */
export function compareOgSvg(week: WeekFile, a: string, b: string): string {
  const A = week.teams[a];
  const B = week.teams[b];
  if (!A || !B) throw new Error(`og: unknown pair ${a} / ${b}`);
  const { width: W, pad } = og;
  const half = W / 2;
  const plate = 84;
  const BLOCK = 272;
  let s = '';
  [A, B].forEach((t, i) => {
    const p = teamPaint(t.colors);
    const x0 = i * half;
    s += rect(x0, 0, half, BLOCK, p.bg);
    if (p.edge) s += frame(x0, 0, half, BLOCK, p.edge);
    s += rect(x0, BLOCK, half, og.rule, p.rule);
    const anchor = i === 0 ? 'start' : 'end';
    const x = i === 0 ? pad : W - pad;
    const independent = week.playoffFormats.some((f) => f.nonConferences.includes(t.conference));
    const kicker = independent ? t.conference : `${t.conference} · ${t.confRecord.w}-${t.confRecord.l}`;
    s += text(x, 76, kicker, 28, p.ink, { weight: 600, anchor });
    s += text(x, 178, t.name, fit(t.name, half - pad - plate / 2 - 28, 96, 40, 800, -0.025), p.ink, { anchor, trackEm: -0.025 });
    s += text(x, 244, `${t.record.w}-${t.record.l}`, 60, p.ink, { anchor, trackEm: -0.02 });
  });
  s += rect(half - plate / 2, BLOCK / 2 - plate / 2, plate, plate, P.fg);
  s += text(half, BLOCK / 2 + 14, 'vs', 40, P.page, { anchor: 'middle' });

  const rows: { label: string; ra: number | null; rb: number | null }[] = [
    ...(week.committee ? [{ label: 'Committee', ra: A.ranks.committee, rb: B.ranks.committee }] : []),
    { label: 'Strength of record', ra: A.ranks.sor, rb: B.ranks.sor },
    { label: 'Offense', ra: A.ranks.off, rb: B.ranks.off },
    { label: 'Defense', ra: A.ranks.def, rb: B.ranks.def },
    { label: 'Schedule', ra: A.ranks.sos, rb: B.ranks.sos },
  ];
  const top = BLOCK + og.rule + 4;
  const rowH = (og.height - og.footer - top - 6) / rows.length;
  rows.forEach((r, i) => {
    const y = top + i * rowH;
    if (i > 0) s += rect(pad, y, W - 2 * pad, 1, P.line);
    const base = y + rowH / 2 + 14;
    const better = r.ra === null ? 'b' : r.rb === null ? 'a' : r.ra < r.rb ? 'a' : r.rb < r.ra ? 'b' : 'tie';
    const style = (side: 'a' | 'b') => (better === side || better === 'tie' ? { fill: P.fg, weight: 800 as const } : { fill: P['fg-muted'], weight: 600 as const });
    const sa = style('a');
    const sb = style('b');
    s += text(pad, base, r.ra === null ? 'NR' : `#${r.ra}`, 40, sa.fill, { weight: sa.weight });
    s += text(W - pad, base, r.rb === null ? 'NR' : `#${r.rb}`, 40, sb.fill, { weight: sb.weight, anchor: 'end' });
    s += text(half, base - 3, r.label, 26, P['fg-muted'], { weight: 600, anchor: 'middle' });
  });
  return svg(s + footer(week));
}

/** Rasterize an OG svg to PNG bytes. */
export function renderPng(svgText: string): Uint8Array<ArrayBuffer> {
  const r = new Resvg(svgText, {
    font: { fontFiles: [fontFile(400), fontFile(600), fontFile(800)], loadSystemFonts: false, defaultFontFamily: fonts.family },
    fitTo: { mode: 'original' },
  });
  return new Uint8Array(r.render().asPng());
}
