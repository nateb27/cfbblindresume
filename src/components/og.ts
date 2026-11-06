/**
 * Build-time Open Graph images (DESIGN §16), rendered with @resvg/resvg-js from rectangles and
 * Barlow Condensed glyphs only (the self-hosted TTFs in src/assets/fonts). Node only: used by the
 * prerendered endpoints under src/pages/og/.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { committeeOrder, gwdOrder } from '@lib/data';
import { rankFill, tierFor } from '@lib/tiers';
import type { WeekFile } from '@lib/types';
import { colors, fonts, og, teamPaint, tierColor } from '../styles/tokens';
import { SITE } from './site';

const D = colors.dark;
const fontFile = (w: 600 | 700): string => join(process.cwd(), fonts.ttf[w]);

/* ------------------------------------------------------------------ advance widths from the TTF */

interface Metrics {
  unitsPerEm: number;
  advance: (codePoint: number) => number;
}

function loadMetrics(file: string): Metrics {
  const buf = readFileSync(file);
  const tables: Record<string, number> = {};
  const numTables = buf.readUInt16BE(4);
  for (let i = 0; i < numTables; i++) {
    const o = 12 + 16 * i;
    tables[buf.toString('ascii', o, o + 4)] = buf.readUInt32BE(o + 8);
  }
  const head = tables.head!;
  const unitsPerEm = buf.readUInt16BE(head + 18);
  const numH = buf.readUInt16BE(tables.hhea! + 34);
  const cmapTable = tables.cmap!;
  let sub = -1;
  for (let i = 0; i < buf.readUInt16BE(cmapTable + 2); i++) {
    const pid = buf.readUInt16BE(cmapTable + 4 + i * 8);
    const eid = buf.readUInt16BE(cmapTable + 6 + i * 8);
    if (pid === 3 && eid === 1) sub = cmapTable + buf.readUInt32BE(cmapTable + 8 + i * 8);
  }
  if (sub < 0 || buf.readUInt16BE(sub) !== 4) throw new Error(`og: no format-4 cmap in ${file}`);
  const segX2 = buf.readUInt16BE(sub + 6);
  const ends = sub + 14;
  const starts = ends + segX2 + 2;
  const deltas = starts + segX2;
  const ranges = deltas + segX2;
  const glyph = (c: number): number => {
    for (let i = 0; i < segX2 / 2; i++) {
      if (c > buf.readUInt16BE(ends + 2 * i)) continue;
      const st = buf.readUInt16BE(starts + 2 * i);
      if (c < st) return 0;
      const d = buf.readInt16BE(deltas + 2 * i);
      const r = buf.readUInt16BE(ranges + 2 * i);
      if (!r) return (c + d) & 0xffff;
      const g = buf.readUInt16BE(ranges + 2 * i + r + 2 * (c - st));
      return g ? (g + d) & 0xffff : 0;
    }
    return 0;
  };
  const hmtx = tables.hmtx!;
  return { unitsPerEm, advance: (c) => buf.readUInt16BE(hmtx + 4 * Math.min(glyph(c), numH - 1)) };
}

let metrics: Record<600 | 700, Metrics> | null = null;
function m(w: 600 | 700): Metrics {
  metrics ??= { 600: loadMetrics(fontFile(600)), 700: loadMetrics(fontFile(700)) };
  return metrics[w];
}

/** Rendered width of a string in px (letter-spacing added after every glyph, as resvg does). */
export function textWidth(s: string, size: number, weight: 600 | 700 = 700, track = 0): number {
  const mm = m(weight);
  let w = 0;
  for (const ch of s) w += (mm.advance(ch.codePointAt(0)!) / mm.unitsPerEm) * size + track;
  return w;
}

/** Largest size <= `size` (2px steps, >= `min`) at which `s` fits in `max` px. */
function fit(s: string, max: number, size: number, min: number, weight: 600 | 700 = 700, track = 0): number {
  while (size > min && textWidth(s, size, weight, track) > max) size -= 2;
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
  opts: { weight?: 600 | 700; anchor?: 'start' | 'middle' | 'end'; track?: number } = {},
): string {
  const { weight = 700, anchor = 'start', track = 0 } = opts;
  return `<text x="${x}" y="${y}" font-family="${fonts.condensed}" font-weight="${weight}" font-size="${size}" fill="${fill}" text-anchor="${anchor}" letter-spacing="${track}">${esc(s)}</text>`;
}

const rect = (x: number, y: number, w: number, h: number, fill: string): string =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`;

const svg = (body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${og.width}" height="${og.height}" viewBox="0 0 ${og.width} ${og.height}">${rect(0, 0, og.width, og.height, D.page)}${body}</svg>`;

const footer = (week: WeekFile): string =>
  rect(0, og.height - og.footer, og.width, og.footer, D.surface) +
  text(og.pad, 605, 'CFBBLINDRESUME.COM', 32, D.fg, { track: 1.5 }) +
  text(og.width - og.pad, 604, `${week.label} · Ratings: FEI by ${week.sources.ratings.author}`, 28, D['fg-muted'], { weight: 600, anchor: 'end', track: 0.5 });

/* ------------------------------------------------------------------ images */

/** Team image (DESIGN §16): color block with name + record, stat row, footer. */
export function teamOgSvg(week: WeekFile, slug: string): string {
  const t = week.teams[slug];
  if (!t) throw new Error(`og: unknown team ${slug}`);
  const p = teamPaint(t.colors);
  const { width: W, pad } = og;
  const independent = week.playoffFormats.some((f) => f.nonConferences.includes(t.conference));
  const name = t.name.toUpperCase();
  const rec = `${t.record.w}-${t.record.l}`;
  const recW = textWidth(rec, 120);
  const nameSize = fit(name, W - 2 * pad - recW - 48, 150, 72, 700, 1);
  const kicker = independent ? t.conference.toUpperCase() : `${t.conference.toUpperCase()} · CONF ${t.confRecord.w}-${t.confRecord.l}`;

  let s = rect(0, 0, W, 300, p.bg);
  if (p.edge) s += `<rect x="0.5" y="0.5" width="${W - 1}" height="299" fill="none" stroke="${p.edge}"/>`;
  s += rect(0, 300, W, og.rule, p.rule);
  s += text(pad, 96, kicker, 36, p.ink, { weight: 600, track: 2 });
  s += text(W - pad, 250, rec, 120, p.ink, { anchor: 'end' });
  s += text(pad, 250, name, nameSize, p.ink, { track: 1 });

  const stats: { label: string; rank: number | null; committee: boolean }[] = [
    ...(week.committee ? [{ label: 'Committee', rank: t.ranks.committee, committee: true }] : [{ label: 'FEI overall', rank: t.ranks.fei, committee: false }]),
    { label: 'Strength of record', rank: t.ranks.sor, committee: false },
    { label: 'Offense', rank: t.ranks.off, committee: false },
    { label: 'Defense', rank: t.ranks.def, committee: false },
    { label: 'Schedule', rank: t.ranks.sos, committee: false },
  ];
  const cw = (W - 2 * pad) / stats.length;
  stats.forEach((st, i) => {
    const x = pad + i * cw;
    const label = st.label.toUpperCase();
    s += text(x, 388, label, fit(label, cw - 24, 26, 20, 600, 1.5), D['fg-muted'], { weight: 600, track: 1.5 });
    s += text(x, 478, st.rank === null ? 'NR' : `#${st.rank}`, 92, D.fg);
    const bw = cw - 28;
    const f = st.rank === null ? 0 : st.committee ? 1 : rankFill(st.rank, week.fbsCount);
    const color = st.committee ? D['accent-fill'] : tierColor(tierFor({ fbs: true, feiRank: st.rank ?? week.fbsCount }).stars);
    s += rect(x, 500, bw, 10, D.track);
    if (st.rank !== null) s += rect(x, 500, Math.max(6, Math.round(bw * f)), 10, color);
  });
  return svg(s + footer(week));
}

/**
 * Default site image: wordmark, tagline, and the week's committee top 5 beside FEI's strength of
 * record top 5 as lower-thirds (FEI top 5 alone before the first committee release).
 */
export function defaultOgSvg(week: WeekFile): string {
  const { width: W, pad } = og;
  let s = rect(0, 0, W, 8, D['accent-fill']);
  // Wordmark: CFB · BLIND RESUME
  const wmSize = 64;
  const a = 'CFB';
  const dot = '·';
  s += text(pad, 112, a, wmSize, D.fg, { track: 1 });
  const ax = pad + textWidth(a, wmSize, 700, 1);
  s += text(ax, 112, dot, wmSize, D['accent-fill']);
  s += text(ax + textWidth(dot, wmSize), 112, 'BLIND RESUME', wmSize, D.fg, { track: 1 });
  s += text(pad, 162, SITE.tagline, 34, D['fg-muted'], { weight: 600, track: 0.5 });
  s += text(W - pad, 110, `${week.season} SEASON`, 30, D['fg-muted'], { weight: 600, anchor: 'end', track: 2 });

  const committee = committeeOrder(week);
  const cols: { title: string; order: string[] }[] = [
    ...(committee ? [{ title: 'COMMITTEE', order: committee }] : []),
    { title: 'FEI STRENGTH OF RECORD', order: gwdOrder(week) },
  ];
  const gap = 32;
  const colW = cols.length === 2 ? (W - 2 * pad - gap) / 2 : W - 2 * pad;
  const rowH = 52;
  const rowGap = 10;
  const top = 236;
  cols.forEach((c, ci) => {
    const x = pad + ci * (colW + gap);
    s += text(x, 216, c.title, 26, D['fg-muted'], { weight: 600, track: 2 });
    c.order.slice(0, 5).forEach((slug, i) => {
      const t = week.teams[slug]!;
      const p = teamPaint(t.colors);
      const y = top + i * (rowH + rowGap);
      const plate = 56;
      s += rect(x, y, plate, rowH, D['raised-2']);
      s += text(x + plate / 2, y + 38, String(i + 1), 34, D.fg, { anchor: 'middle' });
      s += rect(x + plate, y, colW - plate, rowH, p.bg);
      if (p.edge) s += `<rect x="${x + plate + 0.5}" y="${y + 0.5}" width="${colW - plate - 1}" height="${rowH - 6}" fill="none" stroke="${p.edge}"/>`;
      s += rect(x + plate, y + rowH - 5, colW - plate, 5, p.rule);
      const nm = t.name.toUpperCase();
      s += text(x + plate + 18, y + 36, nm, fit(nm, colW - plate - 110, 30, 22, 700, 0.5), p.ink, { track: 0.5 });
      s += text(x + colW - 16, y + 35, `${t.record.w}-${t.record.l}`, 28, p.ink, { weight: 600, anchor: 'end' });
    });
  });
  return svg(s + footer(week));
}

/**
 * Compare image: the two teams' lower-thirds side by side with a "VS" plate, then a ratings
 * table (committee, strength of record, offense, defense, schedule) with the better rank bright.
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
    if (p.edge) s += `<rect x="${x0 + 0.5}" y="0.5" width="${half - 1}" height="${BLOCK - 1}" fill="none" stroke="${p.edge}"/>`;
    s += rect(x0, BLOCK, half, og.rule, p.rule);
    const anchor = i === 0 ? 'start' : 'end';
    const x = i === 0 ? pad : W - pad;
    const independent = week.playoffFormats.some((f) => f.nonConferences.includes(t.conference));
    const kicker = independent ? t.conference.toUpperCase() : `${t.conference.toUpperCase()} · ${t.confRecord.w}-${t.confRecord.l}`;
    s += text(x, 76, kicker, 30, p.ink, { weight: 600, anchor, track: 2 });
    const name = t.name.toUpperCase();
    s += text(x, 178, name, fit(name, half - pad - plate / 2 - 28, 104, 44, 700, 1), p.ink, { anchor, track: 1 });
    s += text(x, 244, `${t.record.w}-${t.record.l}`, 64, p.ink, { weight: 700, anchor });
  });
  s += rect(half - plate / 2, BLOCK / 2 - plate / 2, plate, plate, D.page);
  s += text(half, BLOCK / 2 + 15, 'VS', 42, D.fg, { anchor: 'middle', track: 1 });

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
    if (i > 0) s += rect(pad, y, W - 2 * pad, 1, D.line);
    const base = y + rowH / 2 + 14;
    const better = r.ra === null ? 'b' : r.rb === null ? 'a' : r.ra < r.rb ? 'a' : r.rb < r.ra ? 'b' : 'tie';
    const col = (side: 'a' | 'b') => (better === side || better === 'tie' ? D.fg : D['fg-muted']);
    s += text(pad, base, r.ra === null ? 'NR' : `#${r.ra}`, 40, col('a'));
    s += text(W - pad, base, r.rb === null ? 'NR' : `#${r.rb}`, 40, col('b'), { anchor: 'end' });
    s += text(half, base - 3, r.label.toUpperCase(), 26, D['fg-muted'], { weight: 600, anchor: 'middle', track: 2 });
  });
  return svg(s + footer(week));
}

/** Rasterize an OG svg to PNG bytes. */
export function renderPng(svgText: string): Uint8Array<ArrayBuffer> {
  const r = new Resvg(svgText, {
    font: { fontFiles: [fontFile(600), fontFile(700)], loadSystemFonts: false, defaultFontFamily: fonts.condensed },
    fitTo: { mode: 'original' },
  });
  return new Uint8Array(r.render().asPng());
}
