/**
 * Game pool and prior order (SPEC "pool.ts").
 * - pool  = committee top 25 ∪ FEI GWD top 25 (just the GWD top 25 when there is no committee).
 * - prior = committee order, then pool teams the committee did not rank, in GWD order.
 *           With no committee: GWD order.
 * "GWD top 25" means every FBS team whose GWD rank (`ranks.sor`) is <= 25, so teams tied at 25
 * are all included.
 */
import type { WeekFile } from './types';

/** How many teams make up a "top 25" list (the committee publishes 25; we mirror it for GWD). */
export const TOP_N = 25;

/**
 * Every FBS slug ordered by FEI GWD rank (`ranks.sor`, 1 = best). Ties: higher raw GWD value
 * first, then slug ascending.
 */
export function gwdOrder(week: WeekFile): string[] {
  const teams = Object.values(week.teams);
  teams.sort(
    (a, b) =>
      a.ranks.sor - b.ranks.sor ||
      b.values.gwd - a.values.gwd ||
      (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0),
  );
  return teams.map((t) => t.slug);
}

/**
 * Committee top 25 in rank order (copy), or null before the first release.
 * @throws Error if the committee lists a slug that is not an FBS team in this file.
 */
export function committeeOrder(week: WeekFile): string[] | null {
  if (!week.committee) return null;
  for (const s of week.committee) {
    if (!week.teams[s]) throw new Error(`committee lists unknown team "${s}"`);
  }
  return week.committee.slice();
}

/** Slugs FEI ranks in its GWD top 25 (rank <= 25, ties included), in GWD order. */
export function gwdTop(week: WeekFile, n: number = TOP_N): string[] {
  return gwdOrder(week).filter((s) => week.teams[s]!.ranks.sor <= n);
}

/** Prior order for the game: see module doc. Contains exactly the pool. */
export function prior(week: WeekFile): string[] {
  const committee = committeeOrder(week);
  const gwd = gwdTop(week);
  if (!committee) return gwd;
  const seen = new Set(committee);
  return committee.concat(gwd.filter((s) => !seen.has(s)));
}

/** The game pool as a set-like array, in prior order (identical to {@link prior}). */
export function pool(week: WeekFile): string[] {
  return prior(week);
}

/** Map slug -> 1-based position in an order. */
export function positions(order: readonly string[]): Map<string, number> {
  const m = new Map<string, number>();
  order.forEach((s, i) => m.set(s, i + 1));
  return m;
}
