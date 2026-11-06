/**
 * The user's ranking from picks (SPEC "Ranking algorithm"): committee prior + ranked pairs +
 * isotonic projection. "We start from the committee's ranking and move teams with your picks."
 *
 * Guarantees
 *  (a) if no pick contradicts the prior, the output order equals the prior exactly;
 *  (b) every direct pick is respected unless it loses to stronger evidence in a cycle;
 *  (c) transitive implications of accepted picks are respected.
 */
import { isotonicRegression } from './isotonic';

/** A net pairwise preference from the user's picks. */
export interface PickEdge {
  winner: string;
  loser: string;
  /** |net wins| between the two teams (>= 1). */
  weight: number;
  /** True when the winner is ahead of the loser in the prior. */
  agreesWithPrior: boolean;
}

/** Output of {@link rankFromPicks}. */
export interface RankingResult {
  /** Every prior team, best first. */
  order: string[];
  /** Prior teams that appeared in no round (placed by the same rule, i.e. at their prior slot). */
  unseen: Set<string>;
  /** Isotonic positions (1-based scale of the prior). */
  x: Record<string, number>;
  /** Edges kept by ranked pairs (a DAG), in acceptance order. */
  acceptedEdges: PickEdge[];
  /** Edges rejected because they would close a cycle, in consideration order. */
  droppedEdges: PickEdge[];
}

const cmpStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Pairwise outcomes [winner, loser] implied by ranked rounds: 1st>2nd, 1st>3rd, 2nd>3rd. */
export function pairwiseOutcomes(rounds: readonly (readonly string[])[]): [string, string][] {
  const out: [string, string][] = [];
  for (const r of rounds) {
    for (let i = 0; i < r.length; i++) {
      for (let j = i + 1; j < r.length; j++) out.push([r[i]!, r[j]!]);
    }
  }
  return out;
}

/**
 * Net-win edges (step 2): for each pair with nonzero net wins, an edge winner -> loser with
 * weight |net|. Unsorted. @throws RangeError for teams not in the prior or repeated teams in a round.
 */
export function netEdges(prior: readonly string[], rounds: readonly (readonly string[])[]): PickEdge[] {
  const pos = new Map<string, number>();
  prior.forEach((s, i) => pos.set(s, i + 1));
  for (const r of rounds) {
    if (new Set(r).size !== r.length) throw new RangeError(`round has a repeated team: ${r.join(',')}`);
    for (const s of r) if (!pos.has(s)) throw new RangeError(`team "${s}" is not in the prior`);
  }
  const net = new Map<string, { a: string; b: string; n: number }>();
  for (const [w, l] of pairwiseOutcomes(rounds)) {
    const [a, b] = w < l ? [w, l] : [l, w];
    const key = `${a}\u0000${b}`;
    const e = net.get(key) ?? { a, b, n: 0 };
    e.n += w === a ? 1 : -1;
    net.set(key, e);
  }
  const edges: PickEdge[] = [];
  for (const { a, b, n } of net.values()) {
    if (n === 0) continue;
    const [winner, loser] = n > 0 ? [a, b] : [b, a];
    edges.push({ winner, loser, weight: Math.abs(n), agreesWithPrior: pos.get(winner)! < pos.get(loser)! });
  }
  return edges;
}

/**
 * Ranked-pairs order (step 3): weight desc, prior-agreeing before upsets, smaller prior gap
 * first, then winner slug, then loser slug.
 */
export function rankedPairsOrder(prior: readonly string[], edges: readonly PickEdge[]): PickEdge[] {
  const pos = new Map<string, number>();
  prior.forEach((s, i) => pos.set(s, i + 1));
  const gap = (e: PickEdge): number => Math.abs(pos.get(e.winner)! - pos.get(e.loser)!);
  return [...edges].sort(
    (x, y) =>
      y.weight - x.weight ||
      Number(y.agreesWithPrior) - Number(x.agreesWithPrior) ||
      gap(x) - gap(y) ||
      cmpStr(x.winner, y.winner) ||
      cmpStr(x.loser, y.loser),
  );
}

/**
 * Rank every prior team from the user's ranked rounds (each round is [1st, 2nd, 3rd]).
 * Deterministic; never consults randomness.
 * @throws RangeError if a round names a team outside the prior or repeats a team.
 */
export function rankFromPicks(prior: readonly string[], rounds: readonly (readonly string[])[]): RankingResult {
  const n = prior.length;
  const idx = new Map<string, number>();
  prior.forEach((s, i) => idx.set(s, i));
  if (idx.size !== n) throw new RangeError('prior has duplicate teams');

  // Steps 1-3: net edges, then ranked pairs.
  const sorted = rankedPairsOrder(prior, netEdges(prior, rounds));
  const adj: number[][] = Array.from({ length: n }, () => []);
  const reaches = (from: number, target: number): boolean => {
    const seen = new Uint8Array(n);
    const stack = [from];
    seen[from] = 1;
    while (stack.length) {
      const u = stack.pop()!;
      if (u === target) return true;
      for (const v of adj[u]!) {
        if (!seen[v]) {
          seen[v] = 1;
          stack.push(v);
        }
      }
    }
    return false;
  };
  const acceptedEdges: PickEdge[] = [];
  const droppedEdges: PickEdge[] = [];
  for (const e of sorted) {
    const w = idx.get(e.winner)!;
    const l = idx.get(e.loser)!;
    if (reaches(l, w)) {
      droppedEdges.push(e);
    } else {
      adj[w]!.push(l);
      acceptedEdges.push(e);
    }
  }

  // Step 4: isotonic projection of prior positions under x_winner <= x_loser.
  const p = prior.map((_, i) => i + 1);
  const xs = isotonicRegression(
    p,
    acceptedEdges.map((e) => [idx.get(e.winner)!, idx.get(e.loser)!] as const),
  );

  // Step 5: topological order, choosing the available node with smallest rounded x, then smaller p.
  const indeg = new Array<number>(n).fill(0);
  for (let u = 0; u < n; u++) for (const v of adj[u]!) indeg[v]!++;
  const key = xs.map((v) => Math.round(v * 1e6));
  const done = new Uint8Array(n);
  const order: string[] = [];
  for (let step = 0; step < n; step++) {
    let best = -1;
    for (let i = 0; i < n; i++) {
      if (done[i] || indeg[i] !== 0) continue;
      if (best === -1 || key[i]! < key[best]! || (key[i] === key[best] && i < best)) best = i;
    }
    /* c8 ignore next */
    if (best === -1) throw new Error('rankFromPicks: accepted edges contain a cycle');
    done[best] = 1;
    order.push(prior[best]!);
    for (const v of adj[best]!) indeg[v]!--;
  }

  const seen = new Set<string>();
  for (const r of rounds) for (const s of r) seen.add(s);
  const unseen = new Set(prior.filter((s) => !seen.has(s)));
  const x: Record<string, number> = {};
  prior.forEach((s, i) => (x[s] = xs[i]!));
  return { order, unseen, x, acceptedEdges, droppedEdges };
}
