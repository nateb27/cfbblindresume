import { describe, expect, it } from 'vitest';
import {
  bracketSeedOrder,
  buildBracket,
  computePlayoff,
  computePlayoffs,
  defaultFormat,
  extendOrder,
  formatById,
  nextPow2,
  nonPoolLeaders,
  orderedFormats,
  playoffContext,
  type BracketGame,
  type BracketSide,
  type PlayoffConference,
  type PlayoffContext,
  type PlayoffResult,
  type Seed,
} from '../src/lib/playoff';
import { gwdOrder, prior } from '../src/lib/pool';
import type { PlayoffFormat, Team, WeekFile } from '../src/lib/types';
import { FIXTURE_POWER, FORMATS, INDEPENDENTS, makeWeek, PLAYOFF_2026, PLAYOFF_24 } from './fixtures/make-week';
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
    schemaVersion: 2,
    season: 2026,
    week: 9,
    asOf: '2026-11-05',
    label: 'After Week 9',
    sources: {
      ratings: { name: 'FEI', author: 'Brian Fremeau', url: 'https://bcftoys.com/2026-fei', throughWeek: 9 },
      games: { name: 'CollegeFootballData.com', url: 'https://collegefootballdata.com' },
      committee: null,
    },
    playoffFormats: FORMATS,
    fbsCount: rows.length,
    teams,
    opponents: {},
    committee: null,
    ...(champions ? { champions } : {}),
  };
}

/** A context from conferences and a GWD rank map (GWD order = rank, then slug). */
function ctxOf(conferences: PlayoffConference[], gwdRank: Record<string, number>, formats: PlayoffFormat[] = FORMATS): PlayoffContext {
  const gwd = Object.keys(gwdRank).sort((a, b) => gwdRank[a]! - gwdRank[b]! || (a < b ? -1 : 1));
  return { formats: orderedFormats(formats), conferences, gwdOrder: gwd };
}

const one = (name: string, slug: string): PlayoffConference => ({ name, champion: null, contenders: [slug] });
const champOf = (res: PlayoffResult, conf: string) => res.champions.find((c) => c.conference === conf);
const u = (i: number): string => `u${String(i).padStart(2, '0')}`;
const us = (n: number, from = 1): string[] => Array.from({ length: n }, (_, i) => u(from + i));
const side = (s: BracketSide): string => (s.kind === 'team' ? `#${s.team.seed}` : s.gameId);
const pairings = (games: BracketGame[]): Record<string, string> =>
  Object.fromEntries(games.map((x) => [x.id, `${side(x.sides[0])} v ${side(x.sides[1])}`]));
/** Seeds that can reach each game, "a/b" for first-round games, "1 v 8/9" style for byes. */
const seedsOf = (games: BracketGame[], s: BracketSide): string => {
  if (s.kind === 'team') return String(s.team.seed);
  const g = games.find((x) => x.id === s.gameId)!;
  return `${seedsOf(games, g.sides[0])}/${seedsOf(games, g.sides[1])}`;
};
const fakeField = (n: number): Seed[] => Array.from({ length: n }, (_, i) => ({ seed: i + 1, slug: `s${i + 1}`, rank: i + 1, bid: 'at-large' as const }));

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
    // the 10-team file cannot fill 12 + 5: every team is appended, in GWD order (c1 is not a champion but fills)
    expect(res.order).toEqual(['a2', 'b2', 'b1', 'a1', 'd1', 'd2', 'nd', 'ind2', 'c2', 'c1']);
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

  it('the week context carries every format (default first) and the full GWD order', () => {
    const week = miniWeek(rows);
    week.playoffFormats = [PLAYOFF_24, PLAYOFF_2026]; // file order need not put the default first
    const ctx = playoffContext(week);
    expect(ctx.formats.map((f) => f.id)).toEqual(['12-team', '24-team']);
    expect(ctx.gwdOrder).toEqual(gwdOrder(week));
    expect(ctx.gwdOrder).toHaveLength(rows.length);
  });
});

describe('formats', () => {
  it('defaultFormat / orderedFormats / formatById', () => {
    expect(defaultFormat(FORMATS).id).toBe('12-team');
    expect(orderedFormats([PLAYOFF_24, PLAYOFF_2026]).map((f) => f.id)).toEqual(['12-team', '24-team']);
    expect(formatById(FORMATS, '24-team')).toBe(PLAYOFF_24);
    expect(() => formatById(FORMATS, '16-team')).toThrow(RangeError);
    expect(() => defaultFormat([PLAYOFF_24])).toThrow(/exactly one default/);
    expect(() => defaultFormat([PLAYOFF_2026, { ...PLAYOFF_24, default: true }])).toThrow(/exactly one default/);
  });

  it('computePlayoff picks the default format when none is given, else by id or object', () => {
    const { ctx, order } = bracketFixture();
    expect(computePlayoff(order, ctx).format.id).toBe('12-team');
    expect(computePlayoff(order, ctx, '24-team').field).toHaveLength(24);
    expect(computePlayoff(order, ctx, PLAYOFF_24).format).toBe(PLAYOFF_24);
    expect(() => computePlayoff(order, ctx, 'nope')).toThrow(RangeError);
  });

  it('computePlayoffs returns every format keyed by id, default first', () => {
    const { ctx, order } = bracketFixture();
    const all = computePlayoffs(order, { ...ctx, formats: [PLAYOFF_24, PLAYOFF_2026] });
    expect(Object.keys(all)).toEqual(['12-team', '24-team']);
    expect(all['12-team']).toEqual(computePlayoff(order, ctx, '12-team'));
    expect(all['24-team']).toEqual(computePlayoff(order, ctx, '24-team'));
  });

  it('rejects a format whose byes are not nextPow2(size) - size, and non-straight seeding', () => {
    const { ctx, order } = bracketFixture();
    expect(() => computePlayoff(order, ctx, { ...PLAYOFF_2026, byes: 2 })).toThrow(/byes/);
    expect(() => computePlayoff(order, ctx, { ...PLAYOFF_24, byes: 4 })).toThrow(/byes/);
    expect(() => computePlayoff(order, ctx, { ...PLAYOFF_2026, seeding: 'snake' as 'straight' })).toThrow(/seeding/);
    // other sizes work whenever the byes match the standard bracket
    expect(computePlayoff(order, ctx, { ...PLAYOFF_2026, id: '16', size: 16, byes: 0 }).games).toHaveLength(15);
    expect(computePlayoff(order, ctx, { ...PLAYOFF_2026, id: '6', size: 6, byes: 2 }).byes).toHaveLength(2);
  });

  it('nextPow2', () => {
    expect([1, 2, 3, 4, 5, 12, 16, 17, 24, 32].map(nextPow2)).toEqual([1, 2, 4, 4, 8, 16, 16, 32, 32, 32]);
  });
});

/** Context with 4 power conferences whose champions sit in the pool, 2 group conferences outside it. */
function bracketFixture(): { ctx: PlayoffContext; order: string[] } {
  const order = us(25);
  const gwdRank: Record<string, number> = Object.fromEntries(order.map((s, i) => [s, i + 1]));
  Object.assign(gwdRank, { g2: 45, g1: 60 });
  return {
    order,
    ctx: ctxOf(
      [one('Conf A', 'u20'), one('Conf B', 'u21'), one('Conf C', 'u22'), one('Conf D', 'u23'), one('G1', 'g1'), one('G2', 'g2')],
      gwdRank,
    ),
  };
}

describe('12-team field, seeds and bracket', () => {
  it('a Group-of champion outside the pool is appended in GWD order and takes the fifth auto bid', () => {
    const { ctx, order } = bracketFixture();
    const res = computePlayoff(order, ctx);
    expect(res.order.slice(25)).toEqual(['g2', 'g1']);
    expect(res.champions.map((c) => c.slug)).toEqual(['u20', 'u21', 'u22', 'u23', 'g2', 'g1']);
    expect(res.champions.map((c) => c.power)).toEqual([true, true, true, true, false, false]);
    expect(res.autoBids.map((s) => s.slug)).toEqual(['u20', 'u21', 'u22', 'u23', 'g2']);
    expect(res.autoBids.every((s) => s.bid === 'champion' && s.rule === 'all')).toBe(true);
    expect(res.atLarge.map((s) => s.slug)).toEqual(us(7));
    expect(res.field.map((s) => s.slug)).toEqual([...us(7), 'u20', 'u21', 'u22', 'u23', 'g2']);
    expect(res.field.find((s) => s.slug === 'g2')).toMatchObject({ seed: 12, bid: 'champion', conference: 'G2', rank: 26 });
    expect(res.firstFiveOut).toEqual(us(5, 8));
  });

  it('only 4 pool champions: non-pool leaders are appended in GWD order (ties by slug) and the best takes the fifth auto bid', () => {
    const order = us(25);
    const ctx: PlayoffContext = {
      formats: FORMATS,
      conferences: [one('P1', 'u03'), one('P2', 'u09'), one('P3', 'u15'), one('P4', 'u18'), one('G1', 'g-alpha'), one('G2', 'g-beta'), one('G3', 'g-gamma'), one('G4', 'g-aaa')],
      // GWD order g-beta (40), g-aaa (55), g-gamma (55), g-alpha (70) differs from slug order and its reverse.
      gwdOrder: [...order, 'g-beta', 'g-aaa', 'g-gamma', 'g-alpha'],
    };
    const leaders = ['g-beta', 'g-aaa', 'g-gamma', 'g-alpha'];
    expect(nonPoolLeaders(order, ctx)).toEqual(leaders);
    const res = computePlayoff(order, ctx);
    expect(res.order.slice(25)).toEqual(leaders);
    expect(res.autoBids.map((s) => s.slug)).toEqual(['u03', 'u09', 'u15', 'u18', 'g-beta']);
    expect(res.field.at(-1)).toMatchObject({ slug: 'g-beta', seed: 12, rank: 26, bid: 'champion', conference: 'G2' });
    expect(res.field.map((s) => s.slug)).toEqual([...us(9), 'u15', 'u18', 'g-beta']);
    expect(res.firstFiveOut).toEqual(us(5, 10));
  });

  it('straight seeding: byes go to the four best-ranked teams, champions or not', () => {
    const { ctx, order } = bracketFixture();
    const res = computePlayoff(order, ctx);
    expect(res.field.map((s) => s.seed)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(res.byes.map((s) => s.slug)).toEqual(us(4));
    expect(res.byes.every((s) => s.bid === 'at-large')).toBe(true);
    for (let i = 1; i < res.field.length; i++) expect(res.field[i]!.rank).toBeGreaterThan(res.field[i - 1]!.rank);
  });

  it('SPEC pairings: first round 5v12, 6v11, 7v10, 8v9; QF 1 v 8/9, 4 v 5/12, 2 v 7/10, 3 v 6/11; then semis and final', () => {
    const { ctx, order } = bracketFixture();
    const res = computePlayoff(order, ctx);
    // Games are listed by round, top to bottom of the standard 16-slot bracket.
    expect(pairings(res.games)).toEqual({
      R1G1: '#8 v #9',
      R1G2: '#5 v #12',
      R1G3: '#7 v #10',
      R1G4: '#6 v #11',
      R2G1: '#1 v R1G1',
      R2G2: '#4 v R1G2',
      R2G3: '#2 v R1G3',
      R2G4: '#3 v R1G4',
      R3G1: 'R2G1 v R2G2',
      R3G2: 'R2G3 v R2G4',
      R4G1: 'R3G1 v R3G2',
    });
    const r1 = res.games.filter((g) => g.round === 1).map((g) => `${seedsOf(res.games, g.sides[0])}v${seedsOf(res.games, g.sides[1])}`);
    expect([...r1].sort((a, b) => parseInt(a) - parseInt(b))).toEqual(['5v12', '6v11', '7v10', '8v9']);
    const qf = res.games.filter((g) => g.round === 2).map((g) => `${seedsOf(res.games, g.sides[0])} v ${seedsOf(res.games, g.sides[1])}`);
    expect(qf).toEqual(['1 v 8/9', '4 v 5/12', '2 v 7/10', '3 v 6/11']);
    expect(res.games.map((x) => x.label)).toEqual([...Array(4).fill('First round'), ...Array(4).fill('Quarterfinal'), 'Semifinal', 'Semifinal', 'Final']);
    expect(res.games.map((x) => x.next)).toEqual(['R2G1', 'R2G2', 'R2G3', 'R2G4', 'R3G1', 'R3G1', 'R3G2', 'R3G2', 'R4G1', 'R4G1', null]);
    expect(res.games.filter((g) => g.round === 2).map((g) => g.slotSeed)).toEqual([1, 4, 2, 3]);
    expect(res.games.map((g) => g.slot)).toEqual([0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 0]);
  });

  it('guaranteed team ranked 12 gets in; ranked 13 is not automatic', () => {
    const base = us(25);
    const ctx = ctxOf(
      ['P1', 'P2', 'P3', 'P4', 'P5'].map((name, i) => one(name, u(20 + i))),
      Object.fromEntries(base.map((s, i) => [s, i + 1])),
    );
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
    // Ranked 3: seeded 3rd either way.
    expect(computePlayoff(at(3), ctx).field.find((s) => s.slug === 'notre-dame')?.seed).toBe(3);
    // The 24-team format has no guarantee: ranked 13 is simply an at-large team there.
    const p24 = computePlayoff(at(13), ctx, '24-team');
    expect(p24.field.find((s) => s.slug === 'notre-dame')?.bid).toBe('at-large');
  });

  it('never gives a champion to a conference listed as nonConference, even if passed in conferences', () => {
    const ctx = ctxOf([one(INDEPENDENTS, 'i1'), one('P1', 'p1')], { i1: 1, p1: 2 });
    expect(computePlayoff(['i1', 'p1'], ctx).champions.map((c) => c.slug)).toEqual(['p1']);
    expect(computePlayoff(['i1', 'p1'], ctx, '24-team').champions.map((c) => c.slug)).toEqual(['p1']);
  });
});

describe('24-team bracket (SPEC "Playoff formats")', () => {
  it('standard 32-slot seed order', () => {
    expect(bracketSeedOrder(16)).toEqual([1, 16, 8, 9, 4, 13, 5, 12, 2, 15, 7, 10, 3, 14, 6, 11]);
    expect(bracketSeedOrder(32)).toEqual([
      1, 32, 16, 17, 8, 25, 9, 24, 4, 29, 13, 20, 5, 28, 12, 21, 2, 31, 15, 18, 7, 26, 10, 23, 3, 30, 14, 19, 6, 27, 11, 22,
    ]);
  });

  it('first round 16v17, 9v24, 13v20, 12v21, 15v18, 10v23, 14v19, 11v22; second round 1 v 16/17, 8 v 9/24, 4 v 13/20, 5 v 12/21, 2 v 15/18, 7 v 10/23, 3 v 14/19, 6 v 11/22', () => {
    const games = buildBracket(fakeField(24));
    const label = (g: BracketGame): string => `${seedsOf(games, g.sides[0])} v ${seedsOf(games, g.sides[1])}`;
    const round = (r: number): string[] => games.filter((g) => g.round === r).map(label);
    expect(round(1)).toEqual(['16 v 17', '9 v 24', '13 v 20', '12 v 21', '15 v 18', '10 v 23', '14 v 19', '11 v 22']);
    expect(round(2)).toEqual(['1 v 16/17', '8 v 9/24', '4 v 13/20', '5 v 12/21', '2 v 15/18', '7 v 10/23', '3 v 14/19', '6 v 11/22']);
    expect(round(3)).toEqual(['1/16/17 v 8/9/24', '4/13/20 v 5/12/21', '2/15/18 v 7/10/23', '3/14/19 v 6/11/22']);
    expect(games.filter((g) => g.round === 3).map((g) => g.slotSeed)).toEqual([1, 4, 2, 3]);
    expect(games.filter((g) => g.round === 4).map((g) => g.slotSeed)).toEqual([1, 2]);
    expect(games.filter((g) => g.round === 5).map((g) => g.slotSeed)).toEqual([1]);
    expect(games).toHaveLength(23); // 24 teams -> 23 games
    expect(games.map((g) => g.label)).toEqual([
      ...Array(8).fill('First round'),
      ...Array(8).fill('Second round'),
      ...Array(4).fill('Quarterfinal'),
      'Semifinal',
      'Semifinal',
      'Final',
    ]);
    // Every game but the final feeds exactly one later game, and that game lists it as a side.
    for (const g of games) {
      if (g.round === 5) {
        expect(g.next).toBeNull();
        continue;
      }
      const nx = games.find((x) => x.id === g.next)!;
      expect(nx.round).toBe(g.round + 1);
      expect(nx.sides.some((s) => s.kind === 'winner' && s.gameId === g.id)).toBe(true);
    }
    // Seeds 1-8 enter in round 2; 9-24 in round 1; the better seed is always sides[0].
    for (const g of games) {
      for (const s of g.sides) if (s.kind === 'team') expect(g.round).toBe(s.team.seed <= 8 ? 2 : 1);
      expect(g.slotSeed).toBe(Math.min(...seedsOf(games, g.sides[0]).split('/').map(Number)));
    }
  });

  it('buildBracket checks the byes it is told', () => {
    expect(() => buildBracket(fakeField(24), 8)).not.toThrow();
    expect(() => buildBracket(fakeField(24), 4)).toThrow(RangeError);
    expect(() => buildBracket(fakeField(12), 4)).not.toThrow();
    expect(buildBracket(fakeField(1))).toEqual([]);
    expect(buildBracket(fakeField(2)).map((g) => g.label)).toEqual(['Final']);
  });
});

describe('24-team field: power / non-power automatic bids', () => {
  // 35-team order: power champions ranked 2, 5, 8 and 30; other champions ranked 25, 26 and 33.
  const order = us(35);
  const ctx = ctxOf(
    [one('Conf A', u(2)), one('Conf B', u(5)), one('Conf C', u(8)), one('Conf D', u(30)), one('G1', u(25)), one('G2', u(26)), one('G3', u(33))],
    Object.fromEntries(order.map((s, i) => [s, i + 1])),
  );
  const p24 = computePlayoff(order, ctx, '24-team');
  const p12 = computePlayoff(order, ctx, '12-team');

  it('a power champion ranked 30th still gets in', () => {
    expect(p24.field.map((s) => s.slug)).toContain(u(30));
    expect(p24.field.find((s) => s.slug === u(30))).toMatchObject({ seed: 24, rank: 30, bid: 'champion', rule: 'power', conference: 'Conf D' });
  });

  it('only one non-power champion gets an automatic bid', () => {
    const auto = p24.autoBids.map((s) => [s.slug, s.rule]);
    expect(auto).toEqual([
      [u(2), 'power'],
      [u(5), 'power'],
      [u(8), 'power'],
      [u(25), 'nonPower'],
      [u(30), 'power'],
    ]);
    expect(p24.autoBids.filter((s) => s.rule === 'nonPower')).toHaveLength(1);
    expect(p24.field.map((s) => s.slug)).not.toContain(u(26)); // the second-best other champion is not automatic
    expect(p24.firstFiveOut).toEqual([u(23), u(24), u(26), u(27), u(28)]);
  });

  it('19 at-large teams fill by order, seeds straight by rank, byes for seeds 1-8', () => {
    expect(p24.atLarge.map((s) => s.slug)).toEqual([u(1), u(3), u(4), u(6), u(7), ...us(14, 9)]);
    expect(p24.atLarge).toHaveLength(19);
    expect(p24.field.map((s) => s.slug)).toEqual([...us(22), u(25), u(30)]);
    expect(p24.field.map((s) => s.seed)).toEqual(Array.from({ length: 24 }, (_, i) => i + 1));
    expect(p24.byes.map((s) => s.seed)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(p24.games).toHaveLength(23);
  });

  it('the same order under the 12-team format: the five highest-ranked champions, so the 30th-ranked power champion is out', () => {
    expect(p12.autoBids.map((s) => s.slug)).toEqual([u(2), u(5), u(8), u(25), u(26)]);
    expect(p12.field.map((s) => s.slug)).not.toContain(u(30));
  });

  it('a power champion outside the order is appended and still gets its bid; a non-power one only if it is the best', () => {
    const short = us(25).filter((s) => s !== u(8)); // Conf C champion missing from the order
    const res = computePlayoff(short, ctx, '24-team');
    expect(res.autoBids.map((s) => s.slug)).toContain(u(8));
    expect(res.autoBids.filter((s) => s.rule === 'nonPower').map((s) => s.slug)).toEqual([u(25)]);
  });

  it('a power conference with no champion candidates leaves its bid unused (no crash), at-large fills the field', () => {
    const c2 = { ...ctx, conferences: ctx.conferences.filter((c) => c.name !== 'Conf D') };
    const res = computePlayoff(order, c2, '24-team');
    expect(res.autoBids.map((s) => s.rule)).toEqual(['power', 'power', 'power', 'nonPower']);
    expect(res.field).toHaveLength(24);
  });
});

describe('order extension', () => {
  it('first five out exists for 24 even from a 25-team order: the best non-order teams are appended in GWD order', () => {
    // GWD order interleaves outside teams x1..x9 with the order's teams; the order is a "committee" 25.
    const order = us(25);
    const gwd = [u(1), 'x1', u(2), 'x2', 'x3', ...us(10, 3), 'x4', 'x5', 'x6', ...us(13, 13), 'x7', 'x8', 'x9', 'g-far'];
    const ctx: PlayoffContext = { formats: FORMATS, conferences: [one('Conf A', u(1)), one('G1', 'g-far')], gwdOrder: gwd };
    const res = computePlayoff(order, ctx, '24-team');
    expect(res.order.slice(0, 25)).toEqual(order);
    // need 24 + 5 - 25 = 4 fill teams (x1..x4, GWD order), plus the champion beyond them
    expect(res.order.slice(25)).toEqual(['x1', 'x2', 'x3', 'x4', 'g-far']);
    expect(res.field).toHaveLength(24);
    expect(res.firstFiveOut).toHaveLength(5);
    expect(res.firstFiveOut).toEqual([u(24), u(25), 'x1', 'x2', 'x3']);
    // the 12-team format needs no fill from a 25-team order: only the missing champion is appended
    expect(computePlayoff(order, ctx, '12-team').order.slice(25)).toEqual(['g-far']);
    // extendOrder directly; duplicates in the input are dropped
    expect(extendOrder([u(1), u(1), u(2)], ctx, 2)).toEqual([u(1), u(2), 'x1', 'x2', 'x3', ...us(2, 3)]);
  });

  it('an empty order becomes the GWD order (as far as the context can fill)', () => {
    const ctx = ctxOf([one('Conf A', u(3)), one('G1', u(38))], Object.fromEntries(us(40).map((s, i) => [s, i + 1])));
    const res = computePlayoff([], ctx, '24-team');
    expect(res.order).toEqual([...us(29), u(38)]);
    expect(res.field).toHaveLength(24);
    expect(res.field.map((s) => s.slug)).toEqual([...us(23), u(38)]);
    expect(res.firstFiveOut).toEqual(us(5, 24));
    // A context too small to fill: the field and the five out are as long as the teams allow.
    const tiny = bracketFixture().ctx; // 27 teams
    const r = computePlayoff([], tiny, '24-team');
    expect(r.order).toHaveLength(27);
    expect(r.field).toHaveLength(24);
    expect(r.firstFiveOut).toHaveLength(3);
  });
});

describe('playoff on a full synthetic week', () => {
  for (const committee of [true, false]) {
    it(`committee ${committee ? 'present' : 'absent'}: 12-team and 24-team fields`, () => {
      const week = makeWeek({ seed: 11, committee });
      const ctx = playoffContext(week);
      expect(ctx.conferences.map((c) => c.name)).not.toContain(INDEPENDENTS);
      const order = prior(week);
      const all = computePlayoffs(order, ctx);
      expect(Object.keys(all)).toEqual(['12-team', '24-team']);
      const res = all['12-team']!;
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
      const r24 = all['24-team']!;
      expect(r24.field).toHaveLength(24);
      expect(r24.byes).toHaveLength(8);
      expect(r24.games).toHaveLength(23);
      expect(r24.firstFiveOut).toHaveLength(5);
      const champs = r24.autoBids.filter((s) => s.bid === 'champion');
      expect(champs.filter((s) => s.rule === 'power').map((s) => s.conference).sort()).toEqual(FIXTURE_POWER);
      expect(champs.filter((s) => s.rule === 'nonPower')).toHaveLength(1);
      expect(r24.champions).toEqual(res.champions.map((c) => ({ ...c, rank: r24.order.indexOf(c.slug) + 1 })));
      // the best non-power champion is the one that gets the bid
      const bestOther = r24.champions.find((c) => !c.power)!;
      expect(champs.find((s) => s.rule === 'nonPower')!.slug).toBe(bestOther.slug);
      for (const s of r24.firstFiveOut) expect(r24.field.map((f) => f.slug)).not.toContain(s);
      expect(new Set(r24.order).size).toBe(r24.order.length);
    });
  }

  it('the committee 25 alone still yields a 24-team field and five out', () => {
    const week = makeWeek({ seed: 12 });
    const res = computePlayoff(week.committee!, playoffContext(week), '24-team');
    expect(res.field).toHaveLength(24);
    expect(res.firstFiveOut).toHaveLength(5);
    expect(res.order.slice(0, 25)).toEqual(week.committee);
    // appended teams follow GWD order
    const g = gwdOrder(week);
    const tail = res.order.slice(25).map((s) => g.indexOf(s));
    expect(tail).toEqual([...tail].sort((a, b) => a - b));
  });
});
