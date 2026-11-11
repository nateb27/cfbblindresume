/**
 * Trio selection (SPEC "Trio selection").
 *
 * Hard rules (never broken):
 *  - a trio (as a set) never repeats;
 *  - through round 15 no team appears more than 3 times; through round 30 no more than 6;
 *  - when the pool has <= 45 teams, every pool team appears at least once by round 15. Coverage is
 *    planned every round (a trio is only eligible if the remaining rounds can still cover every
 *    unseen team), so it can never become impossible late.
 * Soft rules:
 *  - rounds 1-8: members within 8 prior positions of each other (max - min <= 8), preferring
 *    unseen teams and committee-vs-FEI disagreements; the window widens one step at a time only
 *    if no eligible trio fits;
 *  - rounds 9+: adaptive. Pairs still undecided by the transitive closure of the user's accepted
 *    edges are scored by Bradley-Terry closeness p(1-p) (Laplace-marginal p) times closeness in
 *    the current ranking; the trio with the highest total wins.
 * Deterministic given (prior, gwdRank, rounds, rng); use rngForRound(seed, round) for the rng so
 * a run is reproducible from (pool, prior, picks, seed).
 */
import { bradleyTerry } from './bradley-terry';
import { pairwiseOutcomes, rankFromPicks } from './ranking';
import { shuffled, type Rng } from './rng';

export { mulberry32, rngForRound, type Rng } from './rng';

/** Three slugs. From {@link nextTrio}: display order (shuffled). In rounds: the user's order. */
export type Trio = [string, string, string];

/** Game rules for trio selection (from SPEC; not data). */
export const TRIO_RULES = Object.freeze({
  /** Standard run length. */
  baseRounds: 15,
  /** "One more round" may extend a run to this many rounds. */
  maxRounds: 30,
  /** Max appearances per team through round `baseRounds`. */
  capBase: 3,
  /** Max appearances per team through round `maxRounds`. */
  capExtra: 6,
  /** Rounds 1..windowRounds use the prior-position window. */
  windowRounds: 8,
  /** Max prior-position spread (max - min) inside a trio in window rounds. */
  window: 8,
  /** Full coverage by round `baseRounds` is guaranteed for pools up to this size. */
  coverageMaxPool: 45,
});

/** Inputs to trio selection. */
export interface TrioState {
  /** The pool in prior order (index 0 = prior #1). */
  prior: readonly string[];
  /**
   * FEI GWD rank per pool team. Optional; when present, pairs the prior and GWD order disagree on
   * are preferred in window rounds. (With no committee the prior IS GWD order: no disagreements.)
   */
  gwdRank?: Readonly<Record<string, number>>;
  /** Completed rounds, each in the user's order [1st, 2nd, 3rd]. */
  rounds: readonly (readonly string[])[];
}

/** Appearance cap that applies to a 1-based round number. */
export function capFor(round: number): number {
  return round <= TRIO_RULES.baseRounds ? TRIO_RULES.capBase : TRIO_RULES.capExtra;
}

const trioKey = (a: number, b: number, c: number): number => {
  // sort three small ints
  if (a > b) [a, b] = [b, a];
  if (b > c) [b, c] = [c, b];
  if (a > b) [a, b] = [b, a];
  return (a * 256 + b) * 256 + c;
};

interface Prepared {
  n: number;
  idx: Map<string, number>;
  counts: number[];
  used: Set<number>;
  round: number;
  cap: number;
  kmin: number;
  coverage: boolean;
  unseen: number;
  roundsLeftAfter: number;
  /** Teams seen at least once and still under the base cap. */
  fillers: number;
}

function prepare(state: TrioState): Prepared {
  const n = state.prior.length;
  const idx = new Map<string, number>();
  state.prior.forEach((s, i) => idx.set(s, i));
  if (idx.size !== n) throw new RangeError('prior has duplicate teams');
  const counts = new Array<number>(n).fill(0);
  const used = new Set<number>();
  for (const r of state.rounds) {
    if (r.length !== 3) throw new RangeError('every round must have exactly 3 teams');
    const ii = r.map((s) => {
      const i = idx.get(s);
      if (i === undefined) throw new RangeError(`team "${s}" is not in the pool`);
      return i;
    });
    for (const i of ii) counts[i]!++;
    used.add(trioKey(ii[0]!, ii[1]!, ii[2]!));
  }
  const round = state.rounds.length + 1;
  const coverage = n <= TRIO_RULES.coverageMaxPool && round <= TRIO_RULES.baseRounds;
  const unseen = counts.filter((c) => c === 0).length;
  const roundsLeftAfter = TRIO_RULES.baseRounds - round;
  const kmin = coverage ? Math.max(0, unseen - 3 * roundsLeftAfter) : 0;
  const fillers = counts.filter((c) => c >= 1 && c < TRIO_RULES.capBase).length;
  return { n, idx, counts, used, round, cap: capFor(round), kmin, coverage, unseen, roundsLeftAfter, fillers };
}

/** Can the rounds after this one still cover every unseen team if trio (i,j,k) is chosen now? */
function coverageOk(P: Prepared, i: number, j: number, k: number): boolean {
  if (!P.coverage) return true;
  const c = P.counts;
  const newly = (c[i] === 0 ? 1 : 0) + (c[j] === 0 ? 1 : 0) + (c[k] === 0 ? 1 : 0);
  const u = P.unseen - newly;
  const R = P.roundsLeftAfter;
  if (u > 3 * R) return false;
  if (u === 0) return true;
  // The round that covers the last (u mod 3) unseen teams needs fillers: already-seen teams with
  // remaining capacity under the base cap.
  const rem = u % 3;
  if (rem === 0) return true;
  // Filler count after this trio: a team going 0 -> 1 becomes a filler, one reaching the cap stops being one.
  let fillers = P.fillers;
  for (const t of [i, j, k]) {
    const before = c[t]!;
    if (before === 0 && 1 < TRIO_RULES.capBase) fillers++;
    else if (before >= 1 && before + 1 >= TRIO_RULES.capBase && before < TRIO_RULES.capBase) fillers--;
  }
  return fillers >= 3 - rem;
}

function eligible(P: Prepared, i: number, j: number, k: number): boolean {
  const c = P.counts;
  if (c[i]! >= P.cap || c[j]! >= P.cap || c[k]! >= P.cap) return false;
  if (P.used.has(trioKey(i, j, k))) return false;
  const newly = (c[i] === 0 ? 1 : 0) + (c[j] === 0 ? 1 : 0) + (c[k] === 0 ? 1 : 0);
  if (newly < P.kmin) return false;
  return coverageOk(P, i, j, k);
}

function disagreementMatrix(state: TrioState, n: number): Uint8Array | null {
  const g = state.gwdRank;
  if (!g) return null;
  const d = new Uint8Array(n * n);
  for (let i = 0; i < n; i++) {
    const gi = g[state.prior[i]!];
    if (gi === undefined) continue;
    for (let j = i + 1; j < n; j++) {
      const gj = g[state.prior[j]!];
      if (gj !== undefined && gi > gj) {
        d[i * n + j] = 1;
        d[j * n + i] = 1;
      }
    }
  }
  return d;
}

/** Best windowed trio for rounds 1..windowRounds, or null if none fits `window`. */
function pickWindowed(state: TrioState, P: Prepared, window: number, rng: Rng): [number, number, number] | null {
  const { n, counts } = P;
  const dis = disagreementMatrix(state, n);
  let best: [number, number, number] | null = null;
  let bestScore = -Infinity;
  for (let i = 0; i < n; i++) {
    const jmax = Math.min(n - 1, i + window);
    for (let j = i + 1; j <= jmax; j++) {
      for (let k = j + 1; k <= jmax; k++) {
        if (!eligible(P, i, j, k)) continue;
        const unseen = (counts[i] === 0 ? 1 : 0) + (counts[j] === 0 ? 1 : 0) + (counts[k] === 0 ? 1 : 0);
        const hasDis = dis ? dis[i * n + j]! | dis[i * n + k]! | dis[j * n + k]! : 0;
        const score = 4 * unseen + 1.5 * hasDis - 0.05 * (k - i) - 0.2 * (counts[i]! + counts[j]! + counts[k]!) + rng();
        if (score > bestScore) {
          bestScore = score;
          best = [i, j, k];
        }
      }
    }
  }
  return best;
}

/** Best adaptive trio (rounds after the window rounds), or null if no eligible trio exists. */
function pickAdaptive(state: TrioState, P: Prepared, rng: Rng): [number, number, number] | null {
  const { n, counts } = P;
  const prior = state.prior;
  const ranking = rankFromPicks(prior, state.rounds);
  // Transitive closure of accepted edges.
  const adj: number[][] = Array.from({ length: n }, () => []);
  for (const e of ranking.acceptedEdges) adj[P.idx.get(e.winner)!]!.push(P.idx.get(e.loser)!);
  const reach = new Uint8Array(n * n);
  for (let s = 0; s < n; s++) {
    const stack = [s];
    while (stack.length) {
      const u = stack.pop()!;
      for (const v of adj[u]!) {
        if (!reach[s * n + v]) {
          reach[s * n + v] = 1;
          stack.push(v);
        }
      }
    }
  }
  const mean: Record<string, number> = {};
  prior.forEach((s, i) => (mean[s] = -0.15 * (i - (n - 1) / 2)));
  const bt = bradleyTerry(
    prior,
    pairwiseOutcomes(state.rounds).map(([winner, loser]) => ({ winner, loser })),
    { mean, sigma: 1 },
  );
  const rpos = new Array<number>(n);
  ranking.order.forEach((s, r) => (rpos[P.idx.get(s)!] = r));
  const w = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (reach[i * n + j] || reach[j * n + i]) continue;
      const p = bt.probMarginal(prior[i]!, prior[j]!);
      const v = 4 * p * (1 - p) * Math.exp(-Math.abs(rpos[i]! - rpos[j]!) / 4);
      w[i * n + j] = v;
      w[j * n + i] = v;
    }
  }
  let best: [number, number, number] | null = null;
  let bestScore = -Infinity;
  for (let i = 0; i < n; i++) {
    if (counts[i]! >= P.cap) continue;
    for (let j = i + 1; j < n; j++) {
      if (counts[j]! >= P.cap) continue;
      const wij = w[i * n + j]!;
      for (let k = j + 1; k < n; k++) {
        if (!eligible(P, i, j, k)) continue;
        const unseen = (counts[i] === 0 ? 1 : 0) + (counts[j] === 0 ? 1 : 0) + (counts[k] === 0 ? 1 : 0);
        const score =
          wij + w[i * n + k]! + w[j * n + k]! + 0.3 * unseen - 0.05 * (counts[i]! + counts[j]! + counts[k]!) + 0.05 * rng();
        if (score > bestScore) {
          bestScore = score;
          best = [i, j, k];
        }
      }
    }
  }
  return best;
}

/**
 * The next trio to show, in display order (shuffled so card position reveals nothing), or null
 * when the run is at {@link TRIO_RULES.maxRounds} or no trio satisfies the hard rules (only
 * possible for tiny pools; never for 25..45 teams).
 * @throws RangeError if `rounds` names a team outside the prior or a round is not 3 teams.
 */
export function nextTrio(state: TrioState, rng: Rng): Trio | null {
  const P = prepare(state);
  if (P.round > TRIO_RULES.maxRounds || P.n < 3) return null;
  let pick: [number, number, number] | null = null;
  if (P.round <= TRIO_RULES.windowRounds) {
    for (let w = TRIO_RULES.window; w < Math.max(P.n, TRIO_RULES.window + 1) && !pick; w++) {
      pick = pickWindowed(state, P, w, rng);
    }
  } else {
    pick = pickAdaptive(state, P, rng);
  }
  if (!pick) return null;
  const t = shuffled(
    pick.map((i) => state.prior[i]!),
    rng,
  );
  return [t[0]!, t[1]!, t[2]!];
}

/**
 * True when some trio inside the standard window (spread <= 8) satisfies every hard rule for the
 * next round. If this is true in rounds 1-8, {@link nextTrio} returns a windowed trio.
 */
export function windowFeasible(state: TrioState): boolean {
  const P = prepare(state);
  const { n } = P;
  for (let i = 0; i < n; i++) {
    const jmax = Math.min(n - 1, i + TRIO_RULES.window);
    for (let j = i + 1; j <= jmax; j++) for (let k = j + 1; k <= jmax; k++) if (eligible(P, i, j, k)) return true;
  }
  return false;
}

/**
 * Hard-rule violations of a run (empty = valid): round count <= 30, three distinct teams per
 * round, no repeated trio, caps (3 through round 15, 6 through round 30), teams in `pool` when
 * given, and full coverage by round 15 when `pool` is given, has <= 45 teams and the run has >= 15 rounds.
 */
export function runViolations(rounds: readonly (readonly string[])[], pool?: readonly string[]): string[] {
  const out: string[] = [];
  if (rounds.length > TRIO_RULES.maxRounds) out.push(`too many rounds (${rounds.length})`);
  const inPool = pool ? new Set(pool) : null;
  const seenTrios = new Set<string>();
  const counts = new Map<string, number>();
  rounds.forEach((r, ri) => {
    const round = ri + 1;
    if (r.length !== 3 || new Set(r).size !== 3) out.push(`round ${round}: needs 3 distinct teams`);
    for (const s of r) if (inPool && !inPool.has(s)) out.push(`round ${round}: "${s}" not in pool`);
    const key = [...r].sort().join('|');
    if (seenTrios.has(key)) out.push(`round ${round}: repeated trio`);
    seenTrios.add(key);
    for (const s of r) {
      const c = (counts.get(s) ?? 0) + 1;
      counts.set(s, c);
      if (c > capFor(round)) out.push(`round ${round}: "${s}" appears ${c} times (cap ${capFor(round)})`);
    }
  });
  if (pool && pool.length <= TRIO_RULES.coverageMaxPool && rounds.length >= TRIO_RULES.baseRounds) {
    const covered = new Set(rounds.slice(0, TRIO_RULES.baseRounds).flat());
    for (const s of pool) if (!covered.has(s)) out.push(`"${s}" never appeared by round ${TRIO_RULES.baseRounds}`);
  }
  return out;
}

/** True when {@link runViolations} finds nothing. */
export function isValidRun(rounds: readonly (readonly string[])[], pool?: readonly string[]): boolean {
  return runViolations(rounds, pool).length === 0;
}
