import { describe, expect, it } from 'vitest';
import { computePlayoff, nonPoolLeaders, playoffContext, type BracketSide, type PlayoffContext } from '../src/lib/playoff';
import { prior } from '../src/lib/pool';
import type { Team, WeekFile } from '../src/lib/types';
import { makeWeek, PLAYOFF_2026, INDEPENDENTS } from './fixtures/make-week';
import { mulberry32, shuffled } from '../src/lib/rng';

interface Row {
  slug: string;
  conf: string;
  cw: number;
  cl: number;
  sor: number;
}

/** A minimal valid WeekFile (no games) for playoff rules. */
function miniWeek(rows: Row[], champions?: Record<string, string>): WeekFile {
  const teams: Record<string, Team> = {};
  for (const r of rows) {
    teams[r.slug] = {
      slug: r.slug,
      id: 0,
      name: r.slug.toUpperCase(),
      short: r.slug,
      mascot: null,
      conference: r.conf,
      colors: { primary: '#000000', secondary: '#ffffff' },
      record: { w: r.cw + 2, l: r.cl },
      confRecord: { w: r.cw, l: r.cl },
      ranks: { sor: r.sor, sos: 1, off: 1, def: 1, fei: r.sor, committee: null },
      values: { fei: 0, ofei: 0, dfei: 0, gwd: -r.sor, els: 0 },
      games: [],
    };
  }
  return {
    schemaVersion: 1,
    season: 2026,
    week: 9,
    asOf: '2026-11-05',
    label: 'After Week 9',
    sources: {
      ratings: { name: 'FEI', author: 'Brian Fremeau', url: 'https://bcftoys.com/2026-fei', throughWeek: 9 },
      games: { name: 'CollegeFootballData.com', url: 'https://collegefootballdata.com' },
      committee: null,
    },
    playoff: PLAYOFF_2026,
    fbsCount: rows.length,
    teams,
    opponents: {},
    committee: null,
    ...(champions ? { champions } : {}),
  };
}

const champOf = (res: ReturnType<typeof computePlayoff>, conf: string) => res.champions.find((c) => c.conference === conf);

describe('champions and stand-ins', () => {
  const rows: Row[] = [
    { slug: 'a1', conf: 'A', cw: 6, cl: 0, sor: 10 },
    { slug: 'a2', conf: 'A', cw: 5, cl: 1, sor: 2 },
    { slug: 'b1', conf: 'B', cw: 5, cl: 1, sor: 3 },
    { slug: 'b2', conf: 'B', cw: 5, cl: 1, sor: 4 },
    { slug: 'c1', conf: 'C', cw: 4, cl: 1, sor: 40 },
    { slug: 'c2', conf: 'C', cw: 4, cl: 1, sor: 30 },
    { slug: 'd1', conf: 'D', cw: 6, cl: 0, sor: 5 },
    { slug: 'd2', conf: 'D', cw: 5, cl: 1, sor: 6 },
    { slug: 'nd', conf: INDEPENDENTS, cw: 0, cl: 0, sor: 1 },
    { slug: 'ind2', conf: INDEPENDENTS, cw: 1, cl: 0, sor: 7 },
  ];

  it('best conference win pct; tie -> higher in order; then better GWD; actual champion overrides', () => {
    const week = miniWeek(rows, { D: 'd2' });
    const ctx = playoffContext(week);
    const res = computePlayoff(['a2', 'b2', 'b1', 'a1', 'd1', 'd2', 'nd', 'ind2'], ctx);
    expect(champOf(res, 'A')).toMatchObject({ slug: 'a1', standIn: true }); // 6-0 beats 5-1 even though a2 is ranked higher
    expect(champOf(res, 'B')?.slug).toBe('b2'); // tie at 5-1 -> higher in the given order
    expect(champOf(res, 'C')?.slug).toBe('c2'); // tie, neither in order -> better GWD; appended
    expect(champOf(res, 'D')).toMatchObject({ slug: 'd2', standIn: false });
    expect(res.order.slice(-1)).toEqual(['c2']);
    // independents never crown a champion
    expect(res.champions.map((c) => c.conference).sort()).toEqual(['A', 'B', 'C', 'D']);
    // flip the tie-break by order
    expect(champOf(computePlayoff(['b1', 'b2', 'a1'], ctx), 'B')?.slug).toBe('b1');
  });

  it('uses the conference record, not the overall record', () => {
    const week = miniWeek([
      { slug: 'x1', conf: 'X', cw: 3, cl: 2, sor: 1 },
      { slug: 'x2', conf: 'X', cw: 4, cl: 1, sor: 9 },
    ]);
    week.teams.x1!.record = { w: 9, l: 0 };
    week.teams.x2!.record = { w: 5, l: 4 };
    expect(champOf(computePlayoff(['x1', 'x2'], playoffContext(week)), 'X')?.slug).toBe('x2');
  });

  it('non-pool leaders are independent of how the pool is ordered', () => {
    const week = miniWeek(rows);
    const ctx = playoffContext(week);
    const pool = ['a1', 'a2', 'b1', 'b2', 'd1', 'd2', 'nd'];
    const rng = mulberry32(4);
    for (let k = 0; k < 20; k++) expect(nonPoolLeaders(shuffled(pool, rng), ctx)).toEqual(['c2']);
  });
});

/** Context with 4 power conferences whose champions sit in the pool, 2 group conferences outside it. */
function bracketFixture(): { ctx: PlayoffContext; order: string[] } {
  const order = Array.from({ length: 25 }, (_, i) => `u${String(i + 1).padStart(2, '0')}`);
  return {
    order,
    ctx: {
      format: PLAYOFF_2026,
      conferences: [
        { name: 'P1', champion: null, contenders: ['u20'] },
        { name: 'P2', champion: null, contenders: ['u21'] },
        { name: 'P3', champion: null, contenders: ['u22'] },
        { name: 'P4', champion: null, contenders: ['u23'] },
        { name: 'G1', champion: null, contenders: ['g1'] },
        { name: 'G2', champion: null, contenders: ['g2'] },
      ],
      gwdRank: { u20: 20, u21: 21, u22: 22, u23: 23, g1: 60, g2: 45 },
    },
  };
}

describe('field, seeds and bracket', () => {
  it('a Group-of champion outside the pool is appended in GWD order and takes the fifth auto bid', () => {
    const { ctx, order } = bracketFixture();
    const res = computePlayoff(order, ctx);
    expect(res.order.slice(25)).toEqual(['g2', 'g1']);
    expect(res.champions.map((c) => c.slug)).toEqual(['u20', 'u21', 'u22', 'u23', 'g2', 'g1']);
    expect(res.autoBids.map((s) => s.slug)).toEqual(['u20', 'u21', 'u22', 'u23', 'g2']);
    expect(res.autoBids.every((s) => s.bid === 'champion')).toBe(true);
    expect(res.atLarge.map((s) => s.slug)).toEqual(['u01', 'u02', 'u03', 'u04', 'u05', 'u06', 'u07']);
    expect(res.field.map((s) => s.slug)).toEqual(['u01', 'u02', 'u03', 'u04', 'u05', 'u06', 'u07', 'u20', 'u21', 'u22', 'u23', 'g2']);
    expect(res.field.find((s) => s.slug === 'g2')).toMatchObject({ seed: 12, bid: 'champion', conference: 'G2', rank: 26 });
    expect(res.firstFiveOut).toEqual(['u08', 'u09', 'u10', 'u11', 'u12']);
  });

  it('only 4 pool champions: non-pool leaders are appended in GWD order (ties by slug) and the best takes the fifth auto bid', () => {
    const order = Array.from({ length: 25 }, (_, i) => `u${String(i + 1).padStart(2, '0')}`);
    // GWD order g-beta (40), g-aaa (55), g-gamma (55), g-alpha (70) differs from slug order and its reverse.
    const ctx: PlayoffContext = {
      format: PLAYOFF_2026,
      conferences: [
        { name: 'P1', champion: null, contenders: ['u03'] },
        { name: 'P2', champion: null, contenders: ['u09'] },
        { name: 'P3', champion: null, contenders: ['u15'] },
        { name: 'P4', champion: null, contenders: ['u18'] },
        { name: 'G1', champion: null, contenders: ['g-alpha'] },
        { name: 'G2', champion: null, contenders: ['g-beta'] },
        { name: 'G3', champion: null, contenders: ['g-gamma'] },
        { name: 'G4', champion: null, contenders: ['g-aaa'] },
      ],
      gwdRank: { u03: 3, u09: 9, u15: 15, u18: 18, 'g-alpha': 70, 'g-beta': 40, 'g-gamma': 55, 'g-aaa': 55 },
    };
    const leaders = ['g-beta', 'g-aaa', 'g-gamma', 'g-alpha'];
    expect(nonPoolLeaders(order, ctx)).toEqual(leaders);
    const res = computePlayoff(order, ctx);
    expect(res.order.slice(25)).toEqual(leaders);
    expect(res.autoBids.map((s) => s.slug)).toEqual(['u03', 'u09', 'u15', 'u18', 'g-beta']);
    expect(res.field.at(-1)).toMatchObject({ slug: 'g-beta', seed: 12, rank: 26, bid: 'champion', conference: 'G2' });
    expect(res.field.map((s) => s.slug)).toEqual(['u01', 'u02', 'u03', 'u04', 'u05', 'u06', 'u07', 'u08', 'u09', 'u15', 'u18', 'g-beta']);
    expect(res.firstFiveOut).toEqual(['u10', 'u11', 'u12', 'u13', 'u14']);
  });

  it('straight seeding: byes go to the four best-ranked teams, champions or not', () => {
    const { ctx, order } = bracketFixture();
    const res = computePlayoff(order, ctx);
    expect(res.field.map((s) => s.seed)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(res.byes.map((s) => s.slug)).toEqual(['u01', 'u02', 'u03', 'u04']);
    expect(res.byes.every((s) => s.bid === 'at-large')).toBe(true);
    for (let i = 1; i < res.field.length; i++) expect(res.field[i]!.rank).toBeGreaterThan(res.field[i - 1]!.rank);
  });

  it('pairs 5v12, 6v11, 7v10, 8v9; QF 1 v 8/9, 2 v 7/10, 3 v 6/11, 4 v 5/12; then semis and final', () => {
    const { ctx, order } = bracketFixture();
    const res = computePlayoff(order, ctx);
    const side = (s: BracketSide): string => (s.kind === 'team' ? `#${s.team.seed}` : s.gameId);
    const g = Object.fromEntries(res.games.map((x) => [x.id, `${side(x.sides[0])} v ${side(x.sides[1])}`]));
    expect(g).toEqual({
      R1G1: '#5 v #12',
      R1G2: '#6 v #11',
      R1G3: '#7 v #10',
      R1G4: '#8 v #9',
      R2G1: '#1 v R1G4',
      R2G2: '#2 v R1G3',
      R2G3: '#3 v R1G2',
      R2G4: '#4 v R1G1',
      R3G1: 'R2G1 v R2G4',
      R3G2: 'R2G2 v R2G3',
      R4G1: 'R3G1 v R3G2',
    });
    expect(res.games.map((x) => x.label)).toEqual([
      ...Array(4).fill('First round'),
      ...Array(4).fill('Quarterfinal'),
      'Semifinal',
      'Semifinal',
      'Final',
    ]);
  });

  it('guaranteed team ranked 12 gets in; ranked 13 is not automatic', () => {
    const base = Array.from({ length: 25 }, (_, i) => `u${String(i + 1).padStart(2, '0')}`);
    const ctx: PlayoffContext = {
      format: PLAYOFF_2026,
      conferences: ['P1', 'P2', 'P3', 'P4', 'P5'].map((name, i) => ({ name, champion: null, contenders: [`u${20 + i}`] })),
      gwdRank: Object.fromEntries(base.map((s, i) => [s, i + 1])),
    };
    const at = (pos: number): string[] => {
      const o = base.filter((s) => s !== 'notre-dame');
      o.splice(pos - 1, 0, 'notre-dame');
      return o;
    };
    // Ranked 12: the five champions (ranked 20-24 here) + Notre Dame are automatic; six at-large.
    const in12 = computePlayoff(at(12), ctx);
    expect(in12.field.map((s) => s.slug)).toContain('notre-dame');
    expect(in12.autoBids.find((s) => s.slug === 'notre-dame')?.bid).toBe('guaranteed');
    expect(in12.atLarge).toHaveLength(6);
    // Ranked 13: no automatic bid; at-large stops at #7, so Notre Dame is out.
    const out13 = computePlayoff(at(13), ctx);
    expect(out13.field.map((s) => s.slug)).not.toContain('notre-dame');
    expect(out13.autoBids.map((s) => s.slug)).not.toContain('notre-dame');
    expect(out13.atLarge).toHaveLength(7);
    // Ranked 3: in as at-large (no need for the guarantee, still marked guaranteed-auto since it qualifies)
    const top = computePlayoff(at(3), ctx);
    expect(top.field.find((s) => s.slug === 'notre-dame')?.seed).toBe(3);
  });

  it('never gives a champion to a conference listed as nonConference, even if passed in conferences', () => {
    const ctx: PlayoffContext = {
      format: PLAYOFF_2026,
      conferences: [
        { name: INDEPENDENTS, champion: null, contenders: ['i1'] },
        { name: 'P1', champion: null, contenders: ['p1'] },
      ],
      gwdRank: { i1: 1, p1: 2 },
    };
    const res = computePlayoff(['i1', 'p1'], ctx);
    expect(res.champions.map((c) => c.slug)).toEqual(['p1']);
  });
});

describe('playoff on a full synthetic week', () => {
  for (const committee of [true, false]) {
    it(`committee ${committee ? 'present' : 'absent'}: 12-team field with 5 champions`, () => {
      const week = makeWeek({ seed: 11, committee });
      const ctx = playoffContext(week);
      expect(ctx.conferences.map((c) => c.name)).not.toContain(INDEPENDENTS);
      const order = prior(week);
      const res = computePlayoff(order, ctx);
      expect(res.field).toHaveLength(12);
      expect(res.byes).toHaveLength(4);
      expect(res.champions).toHaveLength(10);
      expect(res.autoBids.filter((s) => s.bid === 'champion')).toHaveLength(5);
      expect(res.firstFiveOut).toHaveLength(5);
      expect(res.games).toHaveLength(11);
      for (const s of res.firstFiveOut) expect(res.field.map((f) => f.slug)).not.toContain(s);
      // every champion is the best conference record in its conference
      for (const c of res.champions) {
        const conf = week.teams[c.slug]!.conference;
        const pct = (s: string) => {
          const r = week.teams[s]!.confRecord;
          return r.w + r.l ? r.w / (r.w + r.l) : 0;
        };
        const best = Math.max(...Object.values(week.teams).filter((t) => t.conference === conf).map((t) => pct(t.slug)));
        expect(pct(c.slug)).toBe(best);
      }
    });
  }
});
