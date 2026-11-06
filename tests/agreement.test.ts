import { describe, expect, it } from 'vitest';
import {
  agreement,
  agreementSentence,
  pairwiseAgreement,
  referenceOrder,
  roundAgreement,
  runningLine,
  type AgreementSummary,
} from '../src/lib/agreement';

// Committee ranks a..d; e, f unranked. FEI (GWD) ranks everyone, with a tie between c and d.
const committee = { a: 1, b: 2, c: 3, d: 4, e: null, f: null };
const fei = { a: 2, b: 1, c: 3, d: 3, e: 5, f: 6 };

describe('referenceOrder', () => {
  it('ranked beats unranked; both unranked or equal ranks are not ordered', () => {
    expect(referenceOrder('a', 'b', committee)).toBe(1);
    expect(referenceOrder('b', 'a', committee)).toBe(-1);
    expect(referenceOrder('a', 'e', committee)).toBe(1);
    expect(referenceOrder('e', 'a', committee)).toBe(-1);
    expect(referenceOrder('e', 'f', committee)).toBe(0);
    expect(referenceOrder('c', 'd', fei)).toBe(0);
    expect(referenceOrder('zz', 'a', fei)).toBe(-1); // missing = unranked
  });
});

describe('round match', () => {
  it('matches when consistent on every ordered pair', () => {
    expect(roundAgreement(['a', 'b', 'c'], committee)).toBe(true);
    expect(roundAgreement(['b', 'a', 'c'], committee)).toBe(false);
    expect(roundAgreement(['b', 'a', 'c'], fei)).toBe(true);
  });
  it('ignores pairs of two unranked teams for the committee', () => {
    expect(roundAgreement(['a', 'f', 'e'], committee)).toBe(true);
    expect(roundAgreement(['a', 'e', 'f'], committee)).toBe(true);
    expect(roundAgreement(['e', 'a', 'f'], committee)).toBe(false);
  });
  it('is a match when the reference orders none of the pairs (nothing to contradict)', () => {
    expect(roundAgreement(['e', 'f'], committee)).toBe(true);
    expect(roundAgreement(['f', 'e', 'zz'], committee)).toBe(true); // all three outside the committee top 25
    expect(roundAgreement(['c', 'd', 'c'], fei)).toBe(true); // only tied pairs
  });
  it('is null only when the reference is absent', () => {
    expect(roundAgreement(['a', 'b', 'c'], null)).toBeNull();
  });
  it('ignores FEI ties', () => {
    expect(roundAgreement(['d', 'c', 'e'], fei)).toBe(true);
    expect(roundAgreement(['c', 'd', 'e'], fei)).toBe(true);
  });
});

describe('pairwise and summary', () => {
  const rounds = [
    ['a', 'b', 'c'], // committee 3/3, FEI: a>b wrong, a>c ok, b>c ok -> 2/3
    ['e', 'f', 'a'], // committee: e>f ignored, e>a wrong, f>a wrong -> 0/2; FEI: e>f ok, e>a wrong, f>a wrong -> 1/3
    ['d', 'c', 'b'], // committee: d>c wrong, d>b wrong, c>b wrong -> 0/3; FEI: d>c tie, d>b wrong, c>b wrong -> 0/2
  ];

  it('counts matches out of the pairs each reference orders', () => {
    expect(pairwiseAgreement(rounds, committee)).toEqual({ matched: 3, comparable: 8, share: 3 / 8 });
    expect(pairwiseAgreement(rounds, fei)).toEqual({ matched: 3, comparable: 8, share: 3 / 8 });
    expect(pairwiseAgreement(rounds, null)).toEqual({ matched: 0, comparable: 0, share: null });
  });

  it('summarizes rounds and pairs', () => {
    const s = agreement(rounds, { committee, fei });
    expect(s.rounds).toEqual([
      { committee: true, fei: false },
      { committee: false, fei: false },
      { committee: false, fei: false },
    ]);
    expect(s.roundsMatched.committee).toEqual({ matched: 1, comparable: 3, share: 1 / 3 });
    expect(s.pairwise.calls).toBe(9);
    expect(s.hasCommittee).toBe(true);
    expect(agreementSentence(s)).toBe(
      'Of your 9 head-to-head calls, 3 matched the committee (38% of the 8 it ranks) and 3 matched FEI (38% of the 8 it ranks).',
    );
    expect(runningLine(s)).toBe("You've matched the committee in 1 of 3 rounds, FEI in 0 of 3.");
  });

  it('formats the spec copy exactly when every call is comparable', () => {
    const s: AgreementSummary = {
      rounds: [],
      roundsMatched: { committee: { matched: 4, comparable: 6, share: 4 / 6 }, fei: { matched: 5, comparable: 6, share: 5 / 6 } },
      pairwise: { calls: 45, committee: { matched: 32, comparable: 45, share: 32 / 45 }, fei: { matched: 38, comparable: 45, share: 38 / 45 } },
      hasCommittee: true,
    };
    expect(agreementSentence(s)).toBe('Of your 45 head-to-head calls, 32 matched the committee (71%) and 38 matched FEI (84%).');
    expect(runningLine(s)).toBe("You've matched the committee in 4 of 6 rounds, FEI in 5 of 6.");
  });

  it('omits the committee before the first release', () => {
    const s = agreement([['a', 'b', 'c']], { committee: null, fei });
    expect(s.hasCommittee).toBe(false);
    expect(s.rounds[0]!.committee).toBeNull();
    expect(agreementSentence(s)).toBe('Of your 3 head-to-head calls, 2 matched FEI (67%).');
    expect(runningLine(s)).toBe("You've matched FEI in 0 of 1 round.");
  });

  it('rounds where the committee ranks none of the three count as matches: denominator = rounds played', () => {
    // x, y, z are outside the committee top 25.
    const c = { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, x: null, y: null, z: null };
    const f = { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, x: 7, y: 8, z: 9 };
    const played = [
      ['a', 'b', 'c'],
      ['d', 'e', 'f'],
      ['a', 'd', 'x'],
      ['b', 'e', 'y'],
      ['c', 'f', 'z'],
      ['x', 'y', 'z'],
    ];
    const s = agreement(played, { committee: c, fei: f });
    expect(s.rounds[5]).toEqual({ committee: true, fei: true });
    expect(s.roundsMatched.committee).toEqual({ matched: 6, comparable: 6, share: 1 });
    expect(runningLine(s)).toBe("You've matched the committee in 6 of 6 rounds, FEI in 6 of 6.");
    // The vacuous round still contributes no comparable pairwise calls for the committee.
    expect(s.pairwise.committee).toEqual({ matched: 15, comparable: 15, share: 1 });
    // Disagreeing with FEI on the unranked trio is a committee match but an FEI miss.
    const flipped = agreement([...played.slice(0, 5), ['z', 'y', 'x']], { committee: c, fei: f });
    expect(runningLine(flipped)).toBe("You've matched the committee in 6 of 6 rounds, FEI in 5 of 6.");
    // With a committee release, the committee denominator always equals the rounds played.
    for (let n = 1; n <= played.length; n++) {
      const t = agreement(played.slice(0, n), { committee: c, fei: f });
      expect(t.roundsMatched.committee.comparable).toBe(n);
      expect(t.roundsMatched.fei.comparable).toBe(n);
    }
  });

  it('running line uses each reference\'s own counts and pluralizes by its denominator', () => {
    const base = { rounds: [], pairwise: { calls: 0, committee: { matched: 0, comparable: 0, share: null }, fei: { matched: 0, comparable: 0, share: null } } };
    const s: AgreementSummary = {
      ...base,
      roundsMatched: { committee: { matched: 3, comparable: 5, share: 3 / 5 }, fei: { matched: 4, comparable: 7, share: 4 / 7 } },
      hasCommittee: true,
    };
    expect(runningLine(s)).toBe("You've matched the committee in 3 of 5 rounds, FEI in 4 of 7.");
    const one: AgreementSummary = {
      ...base,
      roundsMatched: { committee: { matched: 1, comparable: 1, share: 1 }, fei: { matched: 0, comparable: 1, share: 0 } },
      hasCommittee: true,
    };
    expect(runningLine(one)).toBe("You've matched the committee in 1 of 1 round, FEI in 0 of 1.");
  });
});
