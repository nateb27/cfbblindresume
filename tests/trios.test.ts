import { describe, expect, it } from 'vitest';
import { mulberry32, rngForRound, shuffled, type Rng } from '../src/lib/rng';
import { capFor, isValidRun, nextTrio, runViolations, TRIO_RULES, windowFeasible, type Trio } from '../src/lib/trios';
import { makePrior } from './fixtures/make-week';

type Policy = 'random' | 'prior' | 'gwd' | 'contrarian';
const POLICIES: Policy[] = ['random', 'prior', 'gwd', 'contrarian'];

function ranker(policy: Policy, prior: readonly string[], gwdRank: Record<string, number>, rng: Rng): (t: Trio) => string[] {
  const pos = new Map(prior.map((s, i) => [s, i]));
  switch (policy) {
    case 'random':
      return (t) => shuffled(t, rng);
    case 'prior':
      return (t) => [...t].sort((a, b) => pos.get(a)! - pos.get(b)!);
    case 'gwd':
      return (t) => [...t].sort((a, b) => gwdRank[a]! - gwdRank[b]! || pos.get(a)! - pos.get(b)!);
    case 'contrarian':
      return (t) => [...t].sort((a, b) => pos.get(b)! - pos.get(a)!);
  }
}

interface RunLog {
  rounds: string[][];
  shown: Trio[];
  windowFeasibleAt: boolean[];
}

function run(prior: string[], gwdRank: Record<string, number> | undefined, seed: number, nRounds: number, policy: Policy): RunLog {
  const rank = ranker(policy, prior, gwdRank ?? Object.fromEntries(prior.map((s, i) => [s, i + 1])), mulberry32(seed * 7 + 3));
  const rounds: string[][] = [];
  const shown: Trio[] = [];
  const windowFeasibleAt: boolean[] = [];
  for (let r = 1; r <= nRounds; r++) {
    const state = { prior, gwdRank, rounds };
    if (r <= TRIO_RULES.windowRounds) windowFeasibleAt.push(windowFeasible(state));
    const t = nextTrio(state, rngForRound(seed, r));
    if (!t) throw new Error(`no trio: n=${prior.length} seed=${seed} round=${r}`);
    shown.push(t);
    rounds.push(rank(t));
  }
  return { rounds, shown, windowFeasibleAt };
}

function checkRun(prior: string[], log: RunLog): void {
  const pos = new Map(prior.map((s, i) => [s, i]));
  const { rounds } = log;
  // no repeated trio
  const keys = rounds.map((r) => [...r].sort().join('|'));
  expect(new Set(keys).size).toBe(keys.length);
  // caps
  const counts = new Map<string, number>();
  rounds.forEach((r, i) => {
    expect(new Set(r).size).toBe(3);
    for (const s of r) {
      expect(pos.has(s)).toBe(true);
      counts.set(s, (counts.get(s) ?? 0) + 1);
      expect(counts.get(s)!).toBeLessThanOrEqual(i + 1 <= 15 ? 3 : 6);
    }
  });
  // coverage by round 15
  if (prior.length <= 45 && rounds.length >= 15) {
    const covered = new Set(rounds.slice(0, 15).flat());
    expect(covered.size).toBe(prior.length);
  }
  // window rule in rounds 1-8 whenever a windowed trio was available
  rounds.slice(0, TRIO_RULES.windowRounds).forEach((r, i) => {
    const ps = r.map((s) => pos.get(s)!);
    const spread = Math.max(...ps) - Math.min(...ps);
    if (log.windowFeasibleAt[i]) expect(spread).toBeLessThanOrEqual(TRIO_RULES.window);
  });
  expect(isValidRun(rounds, prior)).toBe(true);
}

describe('trio selection: 2,000 seeded full runs', () => {
  for (const policy of POLICIES) {
    it(`${policy} user, pools 25..45, committee present and absent`, () => {
      let windowInfeasible = 0;
      for (let k = 0; k < 500; k++) {
        const n = 25 + (k % 21);
        const committee = k % 3 !== 0;
        const { prior, gwdRank } = makePrior(n, 31 * k + POLICIES.indexOf(policy), { committee });
        const seed = 100_000 * POLICIES.indexOf(policy) + k;
        const nRounds = k % 8 === 0 ? 30 : 15;
        const log = run(prior, committee ? gwdRank : undefined, seed, nRounds, policy);
        checkRun(prior, log);
        windowInfeasible += log.windowFeasibleAt.filter((f) => !f).length;
      }
      // In practice a windowed trio is always available for 25..45 teams.
      expect(windowInfeasible).toBe(0);
    }, 300_000);
  }
});

describe('trio selection: properties', () => {
  it('is deterministic given (prior, picks, seed)', () => {
    const { prior, gwdRank } = makePrior(33, 9);
    const a = run(prior, gwdRank, 1234, 20, 'random');
    const b = run(prior, gwdRank, 1234, 20, 'random');
    expect(a.shown).toEqual(b.shown);
    const c = run(prior, gwdRank, 1235, 20, 'random');
    expect(c.shown).not.toEqual(a.shown);
  });

  it('shuffles display order (card position does not leak the prior)', () => {
    const { prior, gwdRank } = makePrior(30, 1);
    const pos = new Map(prior.map((s, i) => [s, i]));
    const firstIsBest = [0, 0, 0];
    for (let seed = 0; seed < 300; seed++) {
      const t = nextTrio({ prior, gwdRank, rounds: [] }, rngForRound(seed, 1))!;
      const best = [0, 1, 2].reduce((m, i) => (pos.get(t[i]!)! < pos.get(t[m]!)! ? i : m), 0);
      firstIsBest[best]!++;
    }
    for (const c of firstIsBest) expect(c).toBeGreaterThan(60);
  });

  it('prefers committee-vs-FEI disagreements in early rounds', () => {
    let withDis = 0;
    for (let seed = 0; seed < 200; seed++) {
      const { prior, gwdRank } = makePrior(32, seed);
      const pos = new Map(prior.map((s, i) => [s, i]));
      const t = nextTrio({ prior, gwdRank, rounds: [] }, rngForRound(seed, 1))!;
      const s = [...t].sort((a, b) => pos.get(a)! - pos.get(b)!);
      const dis = (a: string, b: string): boolean => gwdRank[a]! > gwdRank[b]!;
      if (dis(s[0]!, s[1]!) || dis(s[0]!, s[2]!) || dis(s[1]!, s[2]!)) withDis++;
    }
    expect(withDis).toBeGreaterThan(190);
  });

  it('covers a 45-team pool exactly once in 15 rounds', () => {
    for (let seed = 0; seed < 50; seed++) {
      const { prior, gwdRank } = makePrior(45, seed);
      const log = run(prior, gwdRank, seed, 15, POLICIES[seed % 4]!);
      expect(new Set(log.rounds.flat()).size).toBe(45);
    }
  });

  it('returns null after round 30 and for pools too small to continue', () => {
    const { prior, gwdRank } = makePrior(25, 3);
    const log = run(prior, gwdRank, 3, 30, 'random');
    expect(nextTrio({ prior, gwdRank, rounds: log.rounds }, rngForRound(3, 31))).toBeNull();
    expect(nextTrio({ prior: ['a', 'b'], rounds: [] }, mulberry32(1))).toBeNull();
    // 4 teams: C(4,3)=4 trios, each team in 3 of them -> exactly 4 rounds possible.
    const tiny = ['a', 'b', 'c', 'd'];
    const rounds: string[][] = [];
    for (let r = 1; r <= 4; r++) rounds.push(nextTrio({ prior: tiny, rounds }, rngForRound(1, r))!);
    expect(nextTrio({ prior: tiny, rounds }, rngForRound(1, 5))).toBeNull();
  });

  it('pools larger than 45 still respect the hard rules', () => {
    for (let seed = 0; seed < 20; seed++) {
      const { prior, gwdRank } = makePrior(50, seed);
      const log = run(prior, gwdRank, seed, 30, 'random');
      expect(isValidRun(log.rounds)).toBe(true);
    }
  });

  it('capFor and runViolations', () => {
    expect(capFor(1)).toBe(3);
    expect(capFor(15)).toBe(3);
    expect(capFor(16)).toBe(6);
    expect(runViolations([['a', 'b', 'c'], ['c', 'b', 'a']])).toEqual(['round 2: repeated trio']);
    expect(runViolations([['a', 'a', 'c']])[0]).toMatch(/3 distinct/);
    const capped = [
      ['a', 'b', 'c'],
      ['a', 'b', 'd'],
      ['a', 'c', 'd'],
      ['a', 'b', 'e'],
    ];
    expect(runViolations(capped)).toEqual(['round 4: "a" appears 4 times (cap 3)']);
    expect(runViolations([['a', 'b', 'z']], ['a', 'b', 'c'])).toEqual(['round 1: "z" not in pool']);
    expect(isValidRun(Array.from({ length: 31 }, (_, i) => [`a${i}`, `b${i}`, `c${i}`]))).toBe(false);
  });

  it('rejects rounds with teams outside the pool', () => {
    expect(() => nextTrio({ prior: ['a', 'b', 'c', 'd'], rounds: [['a', 'b', 'x']] }, mulberry32(1))).toThrow(RangeError);
  });
});
