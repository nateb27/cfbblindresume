import { describe, expect, it } from 'vitest';
import { isotonicRegression } from '../src/lib/isotonic';
import { netEdges, pairwiseOutcomes, rankFromPicks, rankedPairsOrder } from '../src/lib/ranking';
import { mulberry32, rngForRound, shuffled, type Rng } from '../src/lib/rng';
import { nextTrio, type Trio } from '../src/lib/trios';
import { dykstra, kktViolation, type Constraint } from './fixtures/qp';
import { makePrior } from './fixtures/make-week';

const byPrior = (prior: readonly string[]) => {
  const pos = new Map(prior.map((s, i) => [s, i]));
  return (t: readonly string[]): string[] => [...t].sort((a, b) => pos.get(a)! - pos.get(b)!);
};

describe('rankFromPicks: spec examples and guarantees', () => {
  it('worked example: prior A,B,C,D + D>A -> B,D,A,C', () => {
    const r = rankFromPicks(['A', 'B', 'C', 'D'], [['D', 'A']]);
    expect(r.order).toEqual(['B', 'D', 'A', 'C']);
    expect(r.x).toEqual({ A: 2.5, B: 2, C: 3, D: 2.5 });
    expect(r.acceptedEdges).toEqual([{ winner: 'D', loser: 'A', weight: 1, agreesWithPrior: false }]);
    expect(r.droppedEdges).toEqual([]);
    expect([...r.unseen].sort()).toEqual(['B', 'C']);
  });

  it('a trio yields 1st>2nd, 1st>3rd, 2nd>3rd', () => {
    expect(pairwiseOutcomes([['x', 'y', 'z']])).toEqual([
      ['x', 'y'],
      ['x', 'z'],
      ['y', 'z'],
    ]);
  });

  it('no picks -> prior, every team unseen', () => {
    const prior = ['a', 'b', 'c'];
    const r = rankFromPicks(prior, []);
    expect(r.order).toEqual(prior);
    expect(r.unseen.size).toBe(3);
  });

  it('(a) picks that never contradict the prior return the prior exactly', () => {
    const rng = mulberry32(5);
    for (let run = 0; run < 200; run++) {
      const n = 25 + (run % 21);
      const { prior } = makePrior(n, run);
      const sort = byPrior(prior);
      const rounds: string[][] = [];
      for (let k = 0; k < 1 + (run % 30); k++) {
        const t = shuffled(prior, rng).slice(0, 3);
        rounds.push(sort(t));
      }
      const r = rankFromPicks(prior, rounds);
      expect(r.order).toEqual(prior);
      prior.forEach((s, i) => expect(r.x[s]).toBe(i + 1));
      expect(r.droppedEdges).toEqual([]);
    }
  });

  it('net wins cancel: a 1-1 split produces no edge', () => {
    const e = netEdges(['a', 'b', 'c'], [
      ['b', 'a', 'c'],
      ['a', 'b', 'c'],
    ]);
    expect(e.find((x) => (x.winner === 'a' && x.loser === 'b') || (x.winner === 'b' && x.loser === 'a'))).toBeUndefined();
    expect(e.filter((x) => x.loser === 'c').map((x) => x.weight)).toEqual([2, 2]);
  });

  it('cycles are resolved deterministically (ranked pairs)', () => {
    // Equal weights: the upset C>A is the one dropped (prior-agreeing edges go first).
    const prior = ['A', 'B', 'C'];
    const rounds = [
      ['A', 'B'],
      ['B', 'C'],
      ['C', 'A'],
    ];
    const r = rankFromPicks(prior, rounds);
    expect(r.droppedEdges).toEqual([{ winner: 'C', loser: 'A', weight: 1, agreesWithPrior: false }]);
    expect(r.order).toEqual(['A', 'B', 'C']);
    // Round order does not matter.
    for (const perm of [
      [2, 0, 1],
      [1, 2, 0],
      [2, 1, 0],
    ]) {
      expect(rankFromPicks(prior, perm.map((i) => rounds[i]!))).toEqual(r);
    }
    // Stronger evidence wins: C>A twice beats the single A>B.
    const r2 = rankFromPicks(prior, [...rounds, ['C', 'A']]);
    expect(r2.acceptedEdges[0]).toMatchObject({ winner: 'C', loser: 'A', weight: 2 });
    expect(r2.droppedEdges.map((e) => `${e.winner}>${e.loser}`)).toEqual(['B>C']);
    expect(r2.order).toEqual(['C', 'A', 'B']);
    expect(r2.order.indexOf('C')).toBeLessThan(r2.order.indexOf('A'));
  });

  it('ranked-pairs ordering: weight, then prior agreement, then prior gap, then slug', () => {
    const prior = ['a', 'b', 'c', 'd', 'e'];
    const edges = [
      { winner: 'e', loser: 'a', weight: 1, agreesWithPrior: false },
      { winner: 'a', loser: 'e', weight: 1, agreesWithPrior: true },
      { winner: 'a', loser: 'b', weight: 1, agreesWithPrior: true },
      { winner: 'c', loser: 'd', weight: 1, agreesWithPrior: true },
      { winner: 'd', loser: 'b', weight: 2, agreesWithPrior: false },
    ];
    expect(rankedPairsOrder(prior, edges).map((e) => `${e.winner}${e.loser}`)).toEqual(['db', 'ab', 'cd', 'ae', 'ea']);
  });

  it('(b)+(c) every accepted edge is respected by the final order; output is a permutation of the prior', () => {
    const rng = mulberry32(99);
    for (let run = 0; run < 300; run++) {
      const n = 10 + (run % 30);
      const prior = Array.from({ length: n }, (_, i) => `t${i}`);
      const rounds = Array.from({ length: 1 + (run % 30) }, () => shuffled(prior, rng).slice(0, 3));
      const r = rankFromPicks(prior, rounds);
      expect([...r.order].sort()).toEqual([...prior].sort());
      const pos = new Map(r.order.map((s, i) => [s, i]));
      for (const e of r.acceptedEdges) expect(pos.get(e.winner)!).toBeLessThan(pos.get(e.loser)!);
      expect(r.acceptedEdges.length + r.droppedEdges.length).toBe(netEdges(prior, rounds).length);
      // x is the exact isotonic projection for the accepted edges
      const idx = new Map(prior.map((s, i) => [s, i]));
      const cons = r.acceptedEdges.map((e) => [idx.get(e.winner)!, idx.get(e.loser)!] as const);
      const v = kktViolation(
        prior.map((_, i) => i + 1),
        cons,
        prior.map((s) => r.x[s]!),
        1e-9,
        22,
      );
      if (v && !v.startsWith('component too large')) throw new Error(v);
    }
  });

  it('rejects teams outside the prior and repeated teams', () => {
    expect(() => rankFromPicks(['a', 'b'], [['a', 'z']])).toThrow(RangeError);
    expect(() => rankFromPicks(['a', 'b', 'c'], [['a', 'a', 'b']])).toThrow(RangeError);
  });
});

/** Play a run with trios from trios.ts, ranking each trio by `policy`. */
function playRun(prior: string[], gwdRank: Record<string, number>, seed: number, rounds: number, policy: (t: Trio, rng: Rng) => string[]): string[][] {
  const played: string[][] = [];
  const userRng = mulberry32(seed ^ 0x5bd1e995);
  for (let r = 1; r <= rounds; r++) {
    const t = nextTrio({ prior, gwdRank, rounds: played }, rngForRound(seed, r));
    if (!t) throw new Error(`no trio at round ${r}`);
    played.push(policy(t, userRng));
  }
  return played;
}

describe('criterion 7 (plan): always picking the higher committee rank reproduces the committee top 25', () => {
  it('500 seeded runs, prior-following user, trios from trios.ts: output === prior exactly', () => {
    for (let seed = 0; seed < 500; seed++) {
      const n = 25 + (seed % 21);
      const { prior, gwdRank } = makePrior(n, 1000 + seed);
      const committee = prior.slice(0, 25);
      const rounds = playRun(prior, gwdRank, seed, seed % 10 === 0 ? 30 : 15, (t) => byPrior(prior)(t));
      const r = rankFromPicks(prior, rounds);
      expect(r.order).toEqual(prior);
      expect(r.order.slice(0, 25)).toEqual(committee);
      expect(r.unseen.size).toBe(0);
    }
  }, 120_000);

  it('picking by committee rank with arbitrary order among unranked teams still yields the committee top 25', () => {
    for (let seed = 0; seed < 200; seed++) {
      const n = 26 + (seed % 20);
      const { prior, gwdRank } = makePrior(n, 5000 + seed);
      const committeeRank = new Map(prior.slice(0, 25).map((s, i) => [s, i + 1]));
      const policy = (t: Trio, rng: Rng): string[] => {
        const ranked = t.filter((s) => committeeRank.has(s)).sort((a, b) => committeeRank.get(a)! - committeeRank.get(b)!);
        return [...ranked, ...shuffled(t.filter((s) => !committeeRank.has(s)), rng)];
      };
      const rounds = playRun(prior, gwdRank, 77 + seed, 15, policy);
      const r = rankFromPicks(prior, rounds);
      expect(r.order.slice(0, 25)).toEqual(prior.slice(0, 25));
    }
  }, 120_000);
});

describe('isotonicRegression is the exact least-squares projection', () => {
  function randomDag(rng: Rng, n: number, m: number): Constraint[] {
    const perm = shuffled(
      Array.from({ length: n }, (_, i) => i),
      rng,
    );
    const set = new Set<string>();
    const out: Constraint[] = [];
    for (let k = 0; k < m * 3 && out.length < m; k++) {
      let i = Math.floor(rng() * n);
      let j = Math.floor(rng() * n);
      if (i === j) continue;
      if (perm.indexOf(i) > perm.indexOf(j)) [i, j] = [j, i];
      const key = `${i},${j}`;
      if (set.has(key)) continue;
      set.add(key);
      out.push([i, j]);
    }
    return out;
  }

  it('KKT certificate (brute force) on 3,000 random small DAGs, integer positions', () => {
    const rng = mulberry32(2024);
    for (let t = 0; t < 3000; t++) {
      const n = 2 + (t % 10);
      const p = shuffled(
        Array.from({ length: n }, (_, i) => i + 1),
        rng,
      );
      const cons = randomDag(rng, n, Math.floor(rng() * n * 1.5));
      const x = isotonicRegression(p, cons);
      expect(kktViolation(p, cons, x)).toBeNull();
    }
  });

  it('KKT certificate on random real-valued targets', () => {
    const rng = mulberry32(31);
    for (let t = 0; t < 1000; t++) {
      const n = 2 + (t % 9);
      const p = Array.from({ length: n }, () => rng() * 10 - 5);
      const cons = randomDag(rng, n, Math.floor(rng() * n * 1.5));
      expect(kktViolation(p, cons, isotonicRegression(p, cons), 1e-9)).toBeNull();
    }
  });

  it('matches Dykstra projection (converged) on 60-node DAGs with 90 constraints', () => {
    const rng = mulberry32(8);
    for (let t = 0; t < 25; t++) {
      const n = 60;
      const p = shuffled(
        Array.from({ length: n }, (_, i) => i + 1),
        rng,
      );
      const cons = randomDag(rng, n, 90);
      const x = isotonicRegression(p, cons);
      const ref = dykstra(p, cons);
      for (let i = 0; i < n; i++) expect(Math.abs(x[i]! - ref[i]!)).toBeLessThan(1e-6);
      const obj = (v: number[]): number => v.reduce((s, xi, i) => s + (xi - p[i]!) ** 2, 0);
      expect(obj(x)).toBeLessThanOrEqual(obj(ref) + 1e-9);
    }
  });

  it('returns p unchanged when p is already feasible, and pools a single violation to the mean', () => {
    expect(isotonicRegression([1, 2, 3], [
      [0, 1],
      [1, 2],
    ])).toEqual([1, 2, 3]);
    expect(isotonicRegression([3, 1], [[0, 1]])).toEqual([2, 2]);
  });
});
