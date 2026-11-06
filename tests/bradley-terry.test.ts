import { describe, expect, it } from 'vitest';
import { bradleyTerry, logistic, type BTComparison } from '../src/lib/bradley-terry';
import { mulberry32 } from '../src/lib/rng';

describe('bradleyTerry', () => {
  it('recovers a known order from synthetic outcomes', () => {
    const rng = mulberry32(42);
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const truth = [3.5, 2.5, 1.5, 0.5, -0.5, -1.5, -2.5, -3.5];
    const comps: BTComparison[] = [];
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        for (let k = 0; k < 80; k++) {
          const iWins = rng() < logistic(truth[i]! - truth[j]!);
          comps.push(iWins ? { winner: ids[i]!, loser: ids[j]! } : { winner: ids[j]!, loser: ids[i]! });
        }
      }
    }
    // Shuffle the id order given to the model so it cannot just echo the input order.
    const fit = bradleyTerry(['e', 'b', 'h', 'a', 'g', 'c', 'f', 'd'], comps, { sigma: 3 });
    expect(fit.converged).toBe(true);
    expect(fit.order()).toEqual(ids);
    // Strength gaps roughly match the truth (prior shrinks a little).
    expect(fit.strength.a! - fit.strength.h!).toBeGreaterThan(4);
    expect(fit.strength.a! - fit.strength.h!).toBeLessThan(9);
  });

  it('accepts weighted (aggregated) comparisons equivalently', () => {
    const many: BTComparison[] = [];
    for (let k = 0; k < 7; k++) many.push({ winner: 'x', loser: 'y' });
    for (let k = 0; k < 3; k++) many.push({ winner: 'y', loser: 'x' });
    const a = bradleyTerry(['x', 'y'], many);
    const b = bradleyTerry(['x', 'y'], [
      { winner: 'x', loser: 'y', weight: 7 },
      { winner: 'y', loser: 'x', weight: 3 },
    ]);
    expect(a.strength.x).toBeCloseTo(b.strength.x!, 12);
    expect(a.prob('x', 'y')).toBeGreaterThan(0.5);
  });

  it('stays finite under perfect separation', () => {
    const comps: BTComparison[] = [
      { winner: 'top', loser: 'mid', weight: 1000 },
      { winner: 'mid', loser: 'low', weight: 1000 },
      { winner: 'top', loser: 'low', weight: 1000 },
    ];
    const fit = bradleyTerry(['top', 'mid', 'low'], comps);
    expect(fit.converged).toBe(true);
    for (const t of fit.theta) expect(Number.isFinite(t)).toBe(true);
    expect(fit.prob('top', 'low')).toBeLessThan(1);
    expect(fit.prob('top', 'low')).toBeGreaterThan(0.99);
    expect(fit.order()).toEqual(['top', 'mid', 'low']);
    for (const row of fit.covariance) for (const v of row) expect(Number.isFinite(v)).toBe(true);
  });

  it('gives symmetric probabilities and variances', () => {
    const rng = mulberry32(7);
    const ids = Array.from({ length: 12 }, (_, i) => `t${i}`);
    const comps: BTComparison[] = [];
    for (let k = 0; k < 60; k++) {
      const a = ids[Math.floor(rng() * 12)]!;
      const b = ids[Math.floor(rng() * 12)]!;
      if (a !== b) comps.push({ winner: a, loser: b });
    }
    const fit = bradleyTerry(ids, comps, { mean: { t0: 1, t11: -1 } });
    for (const a of ids) {
      for (const b of ids) {
        if (a === b) continue;
        expect(fit.prob(a, b) + fit.prob(b, a)).toBeCloseTo(1, 12);
        expect(fit.probMarginal(a, b) + fit.probMarginal(b, a)).toBeCloseTo(1, 12);
        expect(fit.diffVariance(a, b)).toBeCloseTo(fit.diffVariance(b, a), 12);
        expect(fit.diffVariance(a, b)).toBeGreaterThan(0);
        // Uncertainty pulls the marginal probability toward 1/2.
        expect(Math.abs(fit.probMarginal(a, b) - 0.5)).toBeLessThanOrEqual(Math.abs(fit.prob(a, b) - 0.5) + 1e-15);
      }
    }
  });

  it('is the MAP: the gradient vanishes and perturbations lower the log posterior', () => {
    const ids = ['a', 'b', 'c', 'd'];
    const comps: BTComparison[] = [
      { winner: 'a', loser: 'b', weight: 3 },
      { winner: 'b', loser: 'a' },
      { winner: 'b', loser: 'c', weight: 2 },
      { winner: 'c', loser: 'd', weight: 4 },
      { winner: 'd', loser: 'a' },
    ];
    const sigma = 1.3;
    const mean = { a: 0.2, d: -0.4 } as Record<string, number>;
    const fit = bradleyTerry(ids, comps, { sigma, mean });
    const lp = (th: number[]): number => {
      let v = 0;
      for (const c of comps) {
        const d = th[ids.indexOf(c.winner)]! - th[ids.indexOf(c.loser)]!;
        v += (c.weight ?? 1) * Math.log(logistic(d));
      }
      ids.forEach((id, i) => (v -= (th[i]! - (mean[id] ?? 0)) ** 2 / (2 * sigma * sigma)));
      return v;
    };
    const base = lp(fit.theta);
    for (let i = 0; i < ids.length; i++) {
      for (const h of [1e-3, -1e-3]) {
        const th = fit.theta.slice();
        th[i]! += h;
        expect(lp(th)).toBeLessThan(base);
      }
    }
  });

  it('with no data returns the prior mean and sigma^2 covariance', () => {
    const fit = bradleyTerry(['a', 'b'], [], { sigma: 2, mean: { a: 0.5 } });
    expect(fit.strength).toEqual({ a: 0.5, b: 0 });
    expect(fit.covariance[0]![0]).toBeCloseTo(4, 12);
    expect(fit.covariance[0]![1]).toBeCloseTo(0, 12);
  });

  it('rejects bad input', () => {
    expect(() => bradleyTerry(['a'], [{ winner: 'a', loser: 'z' }])).toThrow(RangeError);
    expect(() => bradleyTerry(['a', 'b'], [{ winner: 'a', loser: 'a' }])).toThrow(RangeError);
    expect(() => bradleyTerry(['a', 'b'], [{ winner: 'a', loser: 'b', weight: -1 }])).toThrow(RangeError);
    expect(() => bradleyTerry(['a', 'b'], [], { sigma: 0 })).toThrow(RangeError);
  });
});
