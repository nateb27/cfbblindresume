/**
 * Fans consensus from pairwise vote counts (SPEC deviation 6: pairwise counts, not exact trios).
 * Every stored vote [1st, 2nd, 3rd] adds 1st>2nd, 1st>3rd and 2nd>3rd to `pair_counts`.
 */
import { bradleyTerry, type BTComparison } from '@lib/bradley-terry';

/** A trio's consensus needs at least this many votes on EVERY pair of it. */
export const FANS_MIN_PAIR_VOTES = 20;
/** The fans' top 25 needs at least this many votes in the week. */
export const FANS_TOP25_MIN_VOTES = 200;
/** Teams in the fans' ranking. */
export const FANS_TOP_N = 25;

export interface PairCount {
  winner: string;
  loser: string;
  n: number;
}

/** "winner>loser" -> votes. */
export type PairCounts = Record<string, number>;

export const pairKey = (winner: string, loser: string): string => `${winner}>${loser}`;

export interface TrioConsensus {
  /** The trio in consensus order, or null under the threshold. */
  consensus: string[] | null;
  /** Directed counts for the three pairs ("a>b": n), zeros included. */
  counts: PairCounts;
  /** Fewest votes on any pair (both directions summed). */
  minPairVotes: number;
}

/**
 * Consensus order for a trio. Null unless every pair has >= `min` votes. Otherwise teams are
 * ordered by pairwise majorities won (Copeland); a three-way cycle or ties fall back to the sum of
 * each team's pairwise vote shares, then slug order, so the result is always deterministic.
 */
export function trioConsensus(trio: readonly string[], rows: readonly PairCount[], min = FANS_MIN_PAIR_VOTES): TrioConsensus {
  const counts: PairCounts = {};
  for (const a of trio) for (const b of trio) if (a !== b) counts[pairKey(a, b)] = 0;
  for (const r of rows) {
    const k = pairKey(r.winner, r.loser);
    if (k in counts) counts[k] = (counts[k] ?? 0) + Number(r.n);
  }
  const n = (a: string, b: string): number => counts[pairKey(a, b)] ?? 0;
  let minPairVotes = Infinity;
  for (let i = 0; i < trio.length; i++) for (let j = i + 1; j < trio.length; j++) minPairVotes = Math.min(minPairVotes, n(trio[i]!, trio[j]!) + n(trio[j]!, trio[i]!));
  if (!Number.isFinite(minPairVotes)) minPairVotes = 0;
  if (minPairVotes < min) return { consensus: null, counts, minPairVotes };
  const score = (a: string): [number, number] => {
    let wins = 0;
    let share = 0;
    for (const b of trio) {
      if (b === a) continue;
      const ab = n(a, b);
      const ba = n(b, a);
      if (ab > ba) wins += 1;
      else if (ab === ba) wins += 0.5;
      share += ab / (ab + ba);
    }
    return [wins, share];
  };
  const scored = trio.map((s) => ({ s, k: score(s) }));
  scored.sort((x, y) => y.k[0] - x.k[0] || y.k[1] - x.k[1] || (x.s < y.s ? -1 : x.s > y.s ? 1 : 0));
  return { consensus: scored.map((x) => x.s), counts, minPairVotes };
}

/**
 * The fans' top 25: a Bradley-Terry fit (src/lib/bradley-terry, Gaussian prior, so teams that won
 * or lost every comparison stay finite) over every pairwise count of the week. Ties keep slug order.
 */
export function fansTop25(rows: readonly PairCount[], topN = FANS_TOP_N): string[] {
  const ids = [...new Set(rows.flatMap((r) => [r.winner, r.loser]))].sort();
  if (ids.length < 2) return [];
  const comparisons: BTComparison[] = rows.filter((r) => r.n > 0).map((r) => ({ winner: r.winner, loser: r.loser, weight: Number(r.n) }));
  return bradleyTerry(ids, comparisons).order().slice(0, topN);
}
