/**
 * Layout of the resume strip (ResumeStrip.astro, full variant): the games in date order with their
 * opponent labels, and the column width those labels need. Build time only (reads font metrics).
 */
import { gameRows } from '@lib/data';
import type { WeekFile } from '@lib/types';
import { textWidth } from './text-metrics';

/** Opponent label size (px, Archivo 600). */
export const STRIP_LABEL_PX = 12;
/** Narrowest column (px). */
export const STRIP_MIN_COL = 40;

export type StripGame = ReturnType<typeof gameRows>[number];

/** The team's games in date order. */
export function stripGames(week: WeekFile, slug: string): StripGame[] {
  return gameRows(week, slug).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.week - b.week));
}

/** "@TEX" away, "vs FLA" neutral, "KENT" home, "FCS" for any non-FBS opponent. */
export function stripLabel(week: WeekFile, g: StripGame): string {
  const abbr = g.opp.fbs ? (week.teams[g.opp.slug]?.short ?? g.opp.name) : 'FCS';
  return g.site === 'away' ? `@${abbr}` : g.site === 'neutral' ? `vs ${abbr}` : abbr;
}

/** Rendered label widths (px), from the real Archivo widths. */
export function stripLabelWidths(week: WeekFile, games: StripGame[]): number[] {
  return games.map((g) => textWidth(stripLabel(week, g), STRIP_LABEL_PX, 600));
}

/**
 * Column width: 40px, widened only as much as two neighbouring labels need to keep a 5px gap
 * ("@RUTG" next to "@NEB"), so no label ever overlaps the next one.
 */
export function stripCol(week: WeekFile, slug: string): number {
  const w = stripLabelWidths(week, stripGames(week, slug));
  const need = w.reduce((m, x, i) => (i > 0 ? Math.max(m, (w[i - 1]! + x) / 2 + 5) : m), 0);
  return Math.max(STRIP_MIN_COL, Math.ceil(need));
}
