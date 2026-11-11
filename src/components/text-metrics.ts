/**
 * Archivo advance widths read from the static TTFs (src/assets/fonts/Archivo-{400,600,800}.ttf),
 * for layout decisions made at build time: OG image text fitting and the team-page hero name size.
 * Node only (reads the font files); never imported by client code.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fonts } from '../styles/tokens';

export type FontWeight = 400 | 600 | 800;
export const fontFile = (w: FontWeight): string => join(process.cwd(), fonts.ttf[w]);

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

let metrics: Record<FontWeight, Metrics> | null = null;
function m(w: FontWeight): Metrics {
  metrics ??= { 400: loadMetrics(fontFile(400)), 600: loadMetrics(fontFile(600)), 800: loadMetrics(fontFile(800)) };
  return metrics[w];
}

/** Rendered width of a string in px (letter-spacing added after every glyph, as resvg and CSS do). */
export function textWidth(s: string, size: number, weight: FontWeight = 800, track = 0): number {
  const mm = m(weight);
  let w = 0;
  for (const ch of s) w += (mm.advance(ch.codePointAt(0)!) / mm.unitsPerEm) * size + track;
  return w;
}

/** Hero name tracking in em (CSS `.hero-name`: Archivo 800, letter-spacing -0.025em). */
const HERO_TRACK = -0.025;
/** Phones: the hero's conference line ("SEC 2-4", 13px 600) stays on one line up to this width. */
const HERO_CONF_MAX_PHONE = 92;

/**
 * Phones: true when "Conference USA 1-3" is too wide for one line in the hero meta, so the
 * record goes under the conference name ("Conference USA" / "1-3"). The conference name itself
 * never breaks ("Conference" / "USA 1-3" read as two different things).
 */
export function heroConfBreaks(conf: string, confRecord?: string): boolean {
  return confRecord !== undefined && textWidth(`${conf} ${confRecord}`, 13, 600) > HERO_CONF_MAX_PHONE;
}

/** Best split of a name into two lines at a word boundary (the widest line minimized). */
function bestSplit(words: string[]): { parts: [string, string]; width: number } | null {
  let best: { parts: [string, string]; width: number } | null = null;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' ');
    const b = words.slice(i).join(' ');
    const w = Math.max(textWidth(a, 1, 800, HERO_TRACK), textWidth(b, 1, 800, HERO_TRACK));
    if (!best || w < best.width) best = { parts: [a, b], width: w };
  }
  return best;
}

export interface HeroNameFit {
  /** The name as one line, or two parts that stack on phones and run together from 640px. */
  parts: [string] | [string, string];
  /** CSS custom properties for the name element (see TeamBlock `hero`). */
  style: string;
}

/**
 * Hero name sizing for the team page (TeamBlock size "hero"), from the real Archivo 800 glyph
 * widths of the name as printed (display case, -0.025em tracking), so it is never truncated and
 * never touches the record. The block is a size container; the name's font size is
 * `min(max, (100cqi - M) / k)`: the full size when it fits, smaller only as much as needed,
 * where M = name padding + the record/conference meta (its real width) + a 16px gutter, and
 * k = the name's width per px of font size.
 * Phones: one line when that still gives >= 28px on a 360px screen, else two balanced lines (two
 * 31px lines fit the 72px block). From 640px: one line, up to 52px. Parts keep the name's own case
 * ("Texas A&M", "UL Monroe"): never change their case.
 */
export function heroNameFit(name: string, meta: { record: string; conf: string; confRecord?: string }): HeroNameFit {
  const k1 = textWidth(name, 1, 800, HERO_TRACK);
  const confLine = meta.confRecord === undefined ? meta.conf : `${meta.conf} ${meta.confRecord}`;
  // Phones: the conference line is one line, or the conference name over its record
  // (heroConfBreaks); without a separate record it wraps inside 92px as before.
  const confPhone =
    meta.confRecord === undefined
      ? Math.min(HERO_CONF_MAX_PHONE, textWidth(meta.conf, 13, 600))
      : heroConfBreaks(meta.conf, meta.confRecord)
        ? Math.max(textWidth(meta.conf, 13, 600), textWidth(meta.confRecord, 13, 600))
        : textWidth(confLine, 13, 600);
  const recW = (size: number) => textWidth(meta.record, size, 800, -0.01 * size);
  // 100cqi = the block's content box (its padding-right already excluded). M = name padding-left
  // + meta margin (12) + meta width + a 16px gutter that keeps the name off the record.
  const mPhone = Math.ceil(16 + 12 + Math.max(recW(20), confPhone) + 16);
  const mSm = Math.ceil(24 + 12 + Math.max(recW(28), textWidth(confLine, 15, 600)) + 16);
  const split = bestSplit(name.split(/\s+/));
  const twoLines = split !== null && (360 - 32 - 16 - mPhone) / k1 < 28;
  const kPhone = twoLines ? split.width : k1;
  const r = (n: number) => n.toFixed(3);
  const style = [
    `--hero-fs:min(31px, calc((100cqi - ${mPhone}px) / ${r(kPhone)}))`,
    `--hero-lh:${twoLines ? '1' : '2.125rem'}`,
    `--hero-fs-sm:min(52px, calc((100cqi - ${mSm}px) / ${r(k1)}))`,
  ].join(';');
  return { parts: twoLines ? split.parts : [name], style };
}
