import { describe, expect, it } from 'vitest';
import { rankFill, tierFor, TIERS } from '../src/lib/tiers';

describe('tierFor', () => {
  const fbs = (feiRank: number) => tierFor({ fbs: true, feiRank });

  it.each([
    [1, 'fei1-5', 5],
    [5, 'fei1-5', 5],
    [6, 'fei6-10', 4.5],
    [10, 'fei6-10', 4.5],
    [11, 'fei11-25', 4],
    [25, 'fei11-25', 4],
    [26, 'fei26-50', 3],
    [50, 'fei26-50', 3],
    [51, 'fei51-75', 2],
    [75, 'fei51-75', 2],
    [76, 'fei76-100', 1.5],
    [100, 'fei76-100', 1.5],
    [101, 'fei101+', 1],
    [138, 'fei101+', 1],
    [250, 'fei101+', 1],
  ])('FEI rank %i -> %s (%f stars)', (rank, key, stars) => {
    const t = fbs(rank);
    expect(t.key).toBe(key);
    expect(t.stars).toBe(stars);
  });

  it('uses the labels from the spec', () => {
    expect(fbs(3).label).toBe('FEI 1-5 team');
    expect(fbs(8).label).toBe('FEI 6-10 team');
    expect(fbs(20).label).toBe('FEI 11-25 team');
    expect(fbs(40).label).toBe('FEI 26-50 team');
    expect(fbs(60).label).toBe('FEI 51-75 team');
    expect(fbs(90).label).toBe('FEI 76-100 team');
    expect(fbs(120).label).toBe('FEI 101+ team');
  });

  it('FCS and other non-FBS opponents are half a star', () => {
    const fcs = tierFor({ fbs: false, classification: 'fcs' });
    expect(fcs).toMatchObject({ key: 'fcs', stars: 0.5, label: 'FCS team' });
    expect(tierFor({ fbs: false, classification: 'FCS' }).key).toBe('fcs');
    for (const c of ['ii', 'iii', 'naia', undefined]) {
      expect(tierFor({ fbs: false, classification: c })).toMatchObject({ key: 'nonfbs', stars: 0.5, label: 'Non-FBS team' });
    }
    // a non-FBS opponent ignores any rank passed by mistake
    expect(tierFor({ fbs: false, feiRank: 1, classification: 'fcs' }).key).toBe('fcs');
  });

  it('orders tiers toughest first and order === index', () => {
    TIERS.forEach((t, i) => expect(t.order).toBe(i));
    for (let r = 1; r < 138; r++) expect(fbs(r).order).toBeLessThanOrEqual(fbs(r + 1).order);
    expect(fbs(138).order).toBeLessThan(tierFor({ fbs: false, classification: 'fcs' }).order);
  });

  it('throws on an FBS opponent without a valid rank', () => {
    expect(() => tierFor({ fbs: true })).toThrow(RangeError);
    expect(() => tierFor({ fbs: true, feiRank: 0 })).toThrow(RangeError);
    expect(() => tierFor({ fbs: true, feiRank: 2.5 })).toThrow(RangeError);
  });
});

describe('rankFill', () => {
  it('maps rank 1 to 1 and rank n to 0, linear between', () => {
    expect(rankFill(1, 138)).toBe(1);
    expect(rankFill(138, 138)).toBe(0);
    expect(rankFill(69.5, 138)).toBeCloseTo(0.5, 12);
    expect(rankFill(2, 3)).toBe(0.5);
  });
  it('clamps and handles degenerate counts', () => {
    expect(rankFill(0, 138)).toBe(1);
    expect(rankFill(200, 138)).toBe(0);
    expect(rankFill(1, 1)).toBe(1);
  });
  it('is monotone decreasing in rank', () => {
    for (let r = 1; r < 138; r++) expect(rankFill(r, 138)).toBeGreaterThan(rankFill(r + 1, 138));
  });
});
