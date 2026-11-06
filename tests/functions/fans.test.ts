import { describe, expect, it } from 'vitest';
import { FANS_MIN_PAIR_VOTES, fansTop25, pairKey, trioConsensus, type PairCount } from '../../functions/_lib/fans';

/** Pair counts from votes [1st, 2nd, 3rd], the way /api/vote stores them. */
function countsFrom(votes: string[][]): PairCount[] {
  const m = new Map<string, number>();
  for (const [a, b, c] of votes) for (const [w, l] of [[a, b], [a, c], [b, c]] as const) m.set(pairKey(w!, l!), (m.get(pairKey(w!, l!)) ?? 0) + 1);
  return [...m].map(([k, n]) => {
    const [winner, loser] = k.split('>');
    return { winner: winner!, loser: loser!, n };
  });
}

const rep = <T>(n: number, x: T): T[] => Array.from({ length: n }, () => x);

describe('trioConsensus', () => {
  it('is null until every pair has 20 votes, then orders by pairwise majorities', () => {
    const trio = ['a', 'b', 'c'];
    const under = trioConsensus(trio, countsFrom(rep(19, ['a', 'b', 'c'])));
    expect(under.consensus).toBeNull();
    expect(under.minPairVotes).toBe(19);
    expect(under.counts).toEqual({ 'a>b': 19, 'a>c': 19, 'b>a': 0, 'b>c': 19, 'c>a': 0, 'c>b': 0 });
    const at = trioConsensus(trio, countsFrom([...rep(14, ['b', 'a', 'c']), ...rep(6, ['c', 'b', 'a'])]));
    expect(at.minPairVotes).toBe(FANS_MIN_PAIR_VOTES);
    expect(at.consensus).toEqual(['b', 'a', 'c']);
  });

  it('counts both directions of a pair toward the threshold', () => {
    const r = trioConsensus(['a', 'b', 'c'], countsFrom([...rep(10, ['a', 'b', 'c']), ...rep(10, ['c', 'b', 'a'])]));
    expect(r.minPairVotes).toBe(20);
    expect(r.consensus).not.toBeNull();
  });

  it('a Condorcet winner comes first even if another team has a bigger vote share', () => {
    // a beats b 11-10 and c 11-10; b crushes c 21-0.
    const rows: PairCount[] = [
      { winner: 'a', loser: 'b', n: 11 },
      { winner: 'b', loser: 'a', n: 10 },
      { winner: 'a', loser: 'c', n: 11 },
      { winner: 'c', loser: 'a', n: 10 },
      { winner: 'b', loser: 'c', n: 21 },
    ];
    expect(trioConsensus(['c', 'b', 'a'], rows).consensus).toEqual(['a', 'b', 'c']);
  });

  it('resolves a three-way cycle by vote share, deterministically', () => {
    const rows: PairCount[] = [
      { winner: 'a', loser: 'b', n: 30 },
      { winner: 'b', loser: 'a', n: 10 },
      { winner: 'b', loser: 'c', n: 21 },
      { winner: 'c', loser: 'b', n: 19 },
      { winner: 'c', loser: 'a', n: 22 },
      { winner: 'a', loser: 'c', n: 18 },
    ];
    const r = trioConsensus(['a', 'b', 'c'], rows);
    expect(r.consensus).toEqual(['a', 'c', 'b']);
    expect(trioConsensus(['c', 'a', 'b'], rows).consensus).toEqual(r.consensus);
  });

  it('ignores rows for other teams', () => {
    const rows = [...countsFrom(rep(25, ['a', 'b', 'c'])), { winner: 'z', loser: 'a', n: 99 }];
    expect(trioConsensus(['a', 'b', 'c'], rows).consensus).toEqual(['a', 'b', 'c']);
  });
});

describe('fansTop25', () => {
  it('ranks by Bradley-Terry strength over all pairwise counts', () => {
    const teams = Array.from({ length: 30 }, (_, i) => `t${String(i).padStart(2, '0')}`);
    const votes: string[][] = [];
    // Neighbouring trios, mostly in true order, with some upsets.
    for (let i = 0; i + 2 < teams.length; i++) {
      for (let k = 0; k < 8; k++) votes.push([teams[i]!, teams[i + 1]!, teams[i + 2]!]);
      votes.push([teams[i + 1]!, teams[i]!, teams[i + 2]!]);
    }
    const top = fansTop25(countsFrom(votes));
    expect(top).toHaveLength(25);
    expect(top).toEqual(teams.slice(0, 25));
  });

  it('stays finite under perfect separation and handles tiny inputs', () => {
    expect(fansTop25([{ winner: 'a', loser: 'b', n: 500 }])).toEqual(['a', 'b']);
    expect(fansTop25([])).toEqual([]);
  });
});
