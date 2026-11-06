import { describe, expect, it } from 'vitest';
import { runningLine } from '../src/lib/agreement';
import { gwdOrder, headToHead, prior } from '../src/lib/data';
import {
  buildGameData,
  computeRunResults,
  gameAgreementRefs,
  gameDataPath,
  gamePlayoffContext,
  gameRunViolations,
  gameTrioState,
  h2hKey,
  headToHeadFlags,
  type GameData,
} from '../src/lib/game-data';
import { computePlayoff, playoffContext } from '../src/lib/playoff';
import { mulberry32, rngForRound, shuffled } from '../src/lib/rng';
import { decodeRun, encodeRun } from '../src/lib/sharecode';
import { nextTrio } from '../src/lib/trios';
import { makeWeek } from './fixtures/make-week';

const FORBIDDEN = /ESPN|FPI|SP\+|Game Control/i;

function playPriorRun(gd: GameData, seed: number, rounds = 15): string[][] {
  const pos = new Map(gd.prior.map((s, i) => [s, i]));
  const played: string[][] = [];
  for (let r = 1; r <= rounds; r++) {
    const t = nextTrio(gameTrioState(gd, played), rngForRound(seed, r))!;
    played.push([...t].sort((a, b) => pos.get(a)! - pos.get(b)!));
  }
  return played;
}

describe('buildGameData', () => {
  for (const committee of [true, false]) {
    const week = makeWeek({ seed: 21, committee });
    const gd = buildGameData(week);

    it(`committee ${committee ? 'present' : 'absent'}: shape, pool and cards`, () => {
      expect(gd.v).toBe(1);
      expect(gd.hasCommittee).toBe(committee);
      expect(gd.prior).toEqual(prior(week));
      expect(Object.keys(gd.cards).sort()).toEqual([...gd.prior].sort());
      expect(gd.slugs).toEqual(Object.keys(week.teams).sort());
      expect(gd.ratingsUrl).toBe('https://bcftoys.com/2026-fei');
      expect(gd.tiers.map((t) => t.stars)).toEqual([5, 4.5, 4, 3, 2, 1.5, 1, 0.5, 0.5]);
      for (const s of gd.prior) {
        const t = week.teams[s]!;
        const c = gd.cards[s]!;
        expect(c.ranks).toEqual({ sor: t.ranks.sor, off: t.ranks.off, def: t.ranks.def, sos: t.ranks.sos });
        expect(c.games).toHaveLength(t.games.length);
        expect(c.strip).toHaveLength(t.games.length);
        for (let i = 1; i < c.games.length; i++) expect(c.games[i - 1]![0]).toBeLessThanOrEqual(c.games[i]![0]);
        for (const g of c.games) expect(g[3]).toBeGreaterThan(0);
        expect(gd.teams[s]!.inPool).toBe(true);
      }
      for (const l of gd.leaders) expect(gd.teams[l]!.inPool).toBe(false);
      if (!committee) expect(gd.committee).toBeNull();
    });

    it(`committee ${committee ? 'present' : 'absent'}: no forbidden strings, compact`, () => {
      const json = JSON.stringify(gd);
      expect(json).not.toMatch(FORBIDDEN);
      expect(json.length).toBeLessThan(60_000);
    });

    it(`committee ${committee ? 'present' : 'absent'}: h2h index matches the week file`, () => {
      for (let i = 0; i < gd.prior.length; i++) {
        for (let j = i + 1; j < gd.prior.length; j++) {
          const a = gd.prior[i]!;
          const b = gd.prior[j]!;
          const games = headToHead(week, a, b);
          expect(gd.h2h[h2hKey(a, b)] ?? []).toEqual(games.map((g) => [g.winner, g.margin, g.week]));
        }
      }
    });

    it(`committee ${committee ? 'present' : 'absent'}: playoff from game data equals playoff from the week file`, () => {
      const order = gd.prior;
      const fromGd = computePlayoff(order, gamePlayoffContext(gd));
      const fromWeek = computePlayoff(order, playoffContext(week));
      expect(fromGd.field).toEqual(fromWeek.field);
      expect(fromGd.champions).toEqual(fromWeek.champions);
      expect(fromGd.firstFiveOut).toEqual(fromWeek.firstFiveOut);
      for (const s of fromGd.order) expect(gd.teams[s]).toBeDefined();
      // Orders that do not contain the whole pool (FEI tab, committee tab) and shuffled pools agree too.
      const orders = [gd.feiOrder, gd.committee ?? gd.feiOrder.slice(0, 25), [...gd.prior].reverse(), shuffled(gd.prior, mulberry32(3))];
      for (const o of orders) {
        const a = computePlayoff(o, gamePlayoffContext(gd));
        const b = computePlayoff(o, playoffContext(week));
        expect(a.field).toEqual(b.field);
        expect(a.champions).toEqual(b.champions);
        for (const s of a.order) expect(gd.teams[s]).toBeDefined();
      }
      expect(gd.feiOrder).toHaveLength(30);
      expect(gd.feiOrder.slice(0, 5)).toEqual(gwdOrder(week).slice(0, 5));
    });
  }

  it('flags all three meetings when a trio all played each other', () => {
    const week = makeWeek({ seed: 21 });
    const gd = buildGameData(week);
    const keys = Object.keys(gd.h2h);
    // find a triangle inside the pool
    let tri: string[] | null = null;
    for (const a of gd.prior) for (const b of gd.prior) for (const c of gd.prior) {
      if (!tri && a < b && b < c && gd.h2h[h2hKey(a, b)] && gd.h2h[h2hKey(b, c)] && gd.h2h[h2hKey(a, c)]) tri = [a, b, c];
    }
    expect(keys.length).toBeGreaterThan(0);
    expect(tri).not.toBeNull();
    const flags = headToHeadFlags(gd, tri!);
    expect(flags.length).toBeGreaterThanOrEqual(3);
    for (const f of flags) {
      expect(tri).toContain(f.winner);
      expect(tri).toContain(f.loser);
      expect(f.winner).not.toBe(f.loser);
    }
  });

  it('decided champions (inside and outside the pool) are used and carried in game data', () => {
    const base = makeWeek({ seed: 23 });
    const pool = new Set(prior(base));
    const confA = Object.values(base.teams).filter((t) => t.conference === 'Conf A');
    const confB = Object.values(base.teams).filter((t) => t.conference === 'Conf B');
    const outside = confA.find((t) => !pool.has(t.slug))!; // worst-case: a non-pool, non-leader team wins the title game
    const inside = confB.find((t) => pool.has(t.slug)) ?? confB[0]!;
    const week = makeWeek({ seed: 23, champions: { 'Conf A': outside.slug, 'Conf B': inside.slug } });
    const gd = buildGameData(week);
    expect(gd.leaders).toContain(outside.slug);
    expect(gd.teams[outside.slug]).toBeDefined();
    expect(gd.conferences.find((c) => c.name === 'Conf A')).toEqual({ name: 'Conf A', champion: outside.slug, contenders: [] });
    const res = computePlayoff(gd.prior, gamePlayoffContext(gd));
    expect(res.champions.find((c) => c.conference === 'Conf A')).toMatchObject({ slug: outside.slug, standIn: false });
    expect(res.champions.find((c) => c.conference === 'Conf B')).toMatchObject({ slug: inside.slug, standIn: false });
    expect(res.field).toEqual(computePlayoff(gd.prior, playoffContext(week)).field);
  });

  it('gameDataPath', () => {
    expect(gameDataPath(2026, 9)).toBe('/game-data/2026-9.json');
  });
});

describe('run results from game data', () => {
  const gd = buildGameData(makeWeek({ seed: 22 }));

  it('prior-following run reproduces the committee and agrees 100%', () => {
    const rounds = playPriorRun(gd, 5);
    expect(gameRunViolations(gd, rounds)).toEqual([]);
    const res = computeRunResults(gd, rounds);
    expect(res.partial).toBe(false);
    expect(res.ranking.order).toEqual(gd.prior);
    expect(res.ranking.order.slice(0, 25)).toEqual(gd.committee);
    expect(res.agreement.pairwise.committee.share).toBe(1);
    expect(res.playoff.field).toHaveLength(12);
  });

  it('share code round trip feeds the same results', () => {
    const rounds = playPriorRun(gd, 6, 9);
    const code = encodeRun({ season: gd.season, week: gd.week, rounds }, gd.slugs);
    const dec = decodeRun(code, (s, w) => (s === gd.season && w === gd.week ? gd.slugs : null));
    expect(dec.ok).toBe(true);
    if (!dec.ok) return;
    expect(computeRunResults(gd, dec.value.rounds)).toEqual(computeRunResults(gd, rounds));
    expect(computeRunResults(gd, rounds).partial).toBe(true);
  });

  it('flags runs with teams outside the pool', () => {
    const outside = gd.slugs.find((s) => !gd.prior.includes(s))!;
    expect(gameRunViolations(gd, [[gd.prior[0]!, gd.prior[1]!, outside]])).toHaveLength(1);
  });

  it('agreement refs: committee null without a release', () => {
    const noC = buildGameData(makeWeek({ seed: 22, committee: false }));
    expect(gameAgreementRefs(noC).committee).toBeNull();
    expect(gameAgreementRefs(gd).committee).not.toBeNull();
  });
});

describe('agreement from game data, end to end', () => {
  for (const committee of [true, false]) {
    it(`committee ${committee ? 'present' : 'absent'}: FEI ref = GWD rank (ranks.sor), committee ref = committee rank`, () => {
      const week = makeWeek({ seed: 22, committee });
      const g = buildGameData(week);
      const refs = gameAgreementRefs(g);
      for (const s of g.prior) expect(refs.fei[s]).toBe(week.teams[s]!.ranks.sor);
      for (const s of Object.keys(g.teams)) {
        expect(refs.fei[s]).toBe(week.teams[s]!.ranks.sor);
        if (refs.committee) expect(refs.committee[s] ?? null).toBe(week.teams[s]!.ranks.committee);
      }
    });
  }

  const week = makeWeek({ seed: 22 });
  const g = buildGameData(week);
  const sor = (s: string): number => week.teams[s]!.ranks.sor;
  const com = (s: string): number | null => week.teams[s]!.ranks.committee;

  it('one trio by hand: FEI and committee pairwise counts', () => {
    // Three pool teams with distinct GWD ranks, all in the committee top 25.
    const ranked = [...g.prior].filter((s) => com(s) !== null).sort((a, b) => sor(a) - sor(b));
    const best = ranked[0]!;
    const mid = ranked.find((s) => sor(s) > sor(best))!;
    const worst = ranked.find((s) => sor(s) > sor(mid))!;
    const res = computeRunResults(g, [[worst, best, mid]]).agreement;
    // worst > best (miss), worst > mid (miss), best > mid (match)
    expect(res.pairwise.fei).toEqual({ matched: 1, comparable: 3, share: 1 / 3 });
    expect(res.rounds[0]!.fei).toBe(false);
    expect(computeRunResults(g, [[best, mid, worst]]).agreement.pairwise.fei).toEqual({ matched: 3, comparable: 3, share: 1 });
  });

  it('a mixed 15-round run: pairwise and round counts equal a hand count from the week file', () => {
    // Prior-following trios, every other round reversed so both references see hits and misses.
    const rounds = playPriorRun(g, 7).map((r, i) => (i % 2 ? [...r].reverse() : r));
    let fm = 0, fc = 0, cm = 0, cc = 0, frm = 0, crm = 0;
    for (const [a, b, c] of rounds) {
      let fOk = true;
      let cOk = true;
      for (const [w, l] of [[a!, b!], [a!, c!], [b!, c!]] as const) {
        if (sor(w) !== sor(l)) {
          fc++;
          if (sor(w) < sor(l)) fm++;
          else fOk = false;
        }
        const cw = com(w);
        const cl = com(l);
        if (cw !== null || cl !== null) {
          cc++;
          if (cl === null || (cw !== null && cw < cl)) cm++;
          else cOk = false;
        }
      }
      if (fOk) frm++;
      if (cOk) crm++;
    }
    const res = computeRunResults(g, rounds).agreement;
    expect(res.pairwise.calls).toBe(45);
    expect(res.pairwise.fei).toEqual({ matched: fm, comparable: fc, share: fm / fc });
    expect(res.pairwise.committee).toEqual({ matched: cm, comparable: cc, share: cm / cc });
    expect(res.roundsMatched.fei).toEqual({ matched: frm, comparable: 15, share: frm / 15 });
    expect(res.roundsMatched.committee).toEqual({ matched: crm, comparable: 15, share: crm / 15 });
    expect(runningLine(res)).toBe(`You've matched the committee in ${crm} of 15 rounds, FEI in ${frm} of 15.`);
    // Non-trivial: both references have hits and misses.
    expect(fm).toBeGreaterThan(0);
    expect(fm).toBeLessThan(fc);
    expect(cm).toBeGreaterThan(0);
    expect(cm).toBeLessThan(cc);
  });

  it('rounds of three committee-unranked teams count as matches: running-line denominators = rounds played', () => {
    // makeWeek seed 1 has 6 pool teams outside the committee top 25; coverage forces them into trios.
    const g1 = buildGameData(makeWeek({ seed: 1 }));
    expect(g1.prior.filter((s) => g1.teams[s]!.committee === null).length).toBeGreaterThanOrEqual(3);
    let vacuous = 0;
    for (const seed of [1, 2, 3]) {
      const rounds = playPriorRun(g1, seed);
      vacuous += rounds.filter((r) => r.every((s) => g1.teams[s]!.committee === null)).length;
      const a = computeRunResults(g1, rounds).agreement;
      expect(a.roundsMatched.committee).toEqual({ matched: 15, comparable: 15, share: 1 });
      expect(a.roundsMatched.fei.comparable).toBe(15);
      expect(runningLine(a)).toMatch(/^You've matched the committee in 15 of 15 rounds, FEI in \d+ of 15\.$/);
    }
    expect(vacuous).toBeGreaterThan(0); // the scenario is actually exercised
  });
});
