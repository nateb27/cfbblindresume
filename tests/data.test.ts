import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  bubble,
  comparePairs,
  conferenceStandings,
  deltas,
  fbsSlugsSorted,
  gameRows,
  gwdOrder,
  headToHead,
  nearestCompares,
  pool,
  prior,
  qualityWins,
  resumeStrip,
  teamList,
  trioHeadToHead,
} from '../src/lib/data';
import { dataDir, loadAllWeeks, loadLatest, loadSeasonIndex, loadWeek } from '../src/lib/data-node';
import type { Game, WeekFile } from '../src/lib/types';
import { INDEPENDENTS, makeWeek, weekProblems } from './fixtures/make-week';

const WEEK = makeWeek({ seed: 3 });
const NO_COMMITTEE = makeWeek({ seed: 4, committee: false });

describe('fixture generator', () => {
  it('builds consistent week files (mirrored games, records, committee ranks)', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      for (const committee of [true, false]) {
        const w = makeWeek({ seed, committee, nTeams: [138, 12, 26, 138, 60][seed - 1]! });
        expect(weekProblems(w)).toEqual([]);
        expect(Object.keys(w.teams)).toHaveLength(w.fbsCount);
      }
    }
    expect(Object.values(WEEK.opponents).some((o) => o.classification === 'fcs')).toBe(true);
    expect(Object.values(WEEK.opponents).some((o) => o.classification !== 'fcs')).toBe(true);
    const sor = Object.values(WEEK.teams).map((t) => t.ranks.sor);
    expect(new Set(sor).size).toBeLessThan(sor.length); // ties present
  });
});

describe('teams and game rows', () => {
  it('teamList is sorted by name', () => {
    const names = teamList(WEEK).map((t) => t.name);
    expect(names).toEqual([...names].sort());
    expect(names).toHaveLength(138);
  });

  it('fbsSlugsSorted is the sorted slug list', () => {
    const s = fbsSlugsSorted(WEEK);
    expect(s).toEqual(Object.keys(WEEK.teams).sort());
  });

  it('gameRows: toughest first (tier, then opponent FEI rank), tie-break by date', () => {
    for (const t of Object.values(WEEK.teams)) {
      const rows = gameRows(WEEK, t.slug);
      expect(rows).toHaveLength(t.games.length);
      for (let i = 1; i < rows.length; i++) {
        const a = rows[i - 1]!;
        const b = rows[i]!;
        expect(a.tier.order).toBeLessThanOrEqual(b.tier.order);
        if (a.tier.order === b.tier.order) {
          expect(a.opp.feiRank ?? 0).toBeLessThanOrEqual(b.opp.feiRank ?? 0);
          if ((a.opp.feiRank ?? 0) === (b.opp.feiRank ?? 0)) expect(a.date <= b.date).toBe(true);
        }
      }
      for (const r of rows) {
        expect(r.margin).toBe(r.pf - r.pa);
        if (r.opp.fbs) expect(r.tier.order).toBeLessThanOrEqual(6);
        else expect(r.tier.stars).toBe(0.5);
      }
    }
  });

  it('gameRows exact order on a hand-built schedule (FCS last, same-tier ties by date)', () => {
    const w: WeekFile = structuredClone(WEEK);
    const me = Object.values(w.teams).find((t) => t.conference !== INDEPENDENTS)!;
    const byFei = (r: number) => Object.values(w.teams).find((t) => t.ranks.fei === r && t.slug !== me.slug)!;
    const opp30 = byFei(30);
    const opp3 = byFei(3);
    const opp120 = byFei(120);
    const fcs = Object.values(w.opponents).find((o) => o.classification === 'fcs')!;
    const g = (week: number, date: string, opp: string, oppFbs: boolean, pf: number, pa: number): Game => ({
      week,
      date,
      opp,
      oppFbs,
      site: 'home',
      pf,
      pa,
      result: pf > pa ? 'W' : 'L',
      conf: false,
    });
    me.games = [
      g(1, '2026-08-29', fcs.slug, false, 50, 3),
      g(2, '2026-09-05', opp3.slug, true, 10, 20),
      g(3, '2026-09-12', opp120.slug, true, 30, 7),
      g(4, '2026-09-19', opp30.slug, true, 24, 21),
      g(9, '2026-10-31', opp3.slug, true, 27, 24),
    ];
    const rows = gameRows(w, me.slug);
    expect(rows.map((r) => [r.opp.slug, r.week])).toEqual([
      [opp3.slug, 2],
      [opp3.slug, 9],
      [opp30.slug, 4],
      [opp120.slug, 3],
      [fcs.slug, 1],
    ]);
    expect(rows.map((r) => r.tier.label)).toEqual(['FEI 1-5 team', 'FEI 1-5 team', 'FEI 26-50 team', 'FEI 101+ team', 'FCS team']);
    expect(resumeStrip(w, me.slug).map((s) => s.week)).toEqual([1, 2, 3, 4, 9]);
    expect(qualityWins(w, me.slug)).toEqual({ top10: { w: 1, l: 1 }, r11to25: { w: 0, l: 0 }, r26to50: { w: 1, l: 0 } });
  });

  it('qualityWins buckets at the FEI rank boundaries 10/11, 25/26, 50/51', () => {
    const w: WeekFile = structuredClone(WEEK);
    const me = Object.values(w.teams)[0]!;
    // qualityWins reads each opponent's own current FEI rank, so set the six opponents' ranks directly.
    const ranks = [10, 11, 25, 26, 50, 51];
    const opps = Object.values(w.teams)
      .filter((t) => t.slug !== me.slug)
      .slice(0, ranks.length);
    opps.forEach((t, i) => (t.ranks.fei = ranks[i]!));
    const g = (i: number, pf: number, pa: number): Game => ({
      week: i + 1,
      date: `2026-09-0${i + 1}`,
      opp: opps[i]!.slug,
      oppFbs: true,
      site: 'home',
      pf,
      pa,
      result: pf > pa ? 'W' : 'L',
      conf: false,
    });
    // W v 10, L v 11, W v 25, L v 26, W v 50, L v 51 (outside every bucket)
    me.games = [g(0, 21, 14), g(1, 14, 21), g(2, 28, 7), g(3, 7, 28), g(4, 35, 3), g(5, 3, 35)];
    expect(qualityWins(w, me.slug)).toEqual({ top10: { w: 1, l: 0 }, r11to25: { w: 1, l: 1 }, r26to50: { w: 1, l: 1 } });
    // Flip every result: the boundaries hold for losses too.
    me.games = me.games.map((x) => ({ ...x, pf: x.pa, pa: x.pf, result: x.result === 'W' ? 'L' : 'W' }));
    expect(qualityWins(w, me.slug)).toEqual({ top10: { w: 0, l: 1 }, r11to25: { w: 1, l: 1 }, r26to50: { w: 1, l: 1 } });
  });

  it('resumeStrip is chronological; qualityWins counts by current FEI rank', () => {
    for (const t of Object.values(WEEK.teams).slice(0, 40)) {
      const strip = resumeStrip(WEEK, t.slug);
      for (let i = 1; i < strip.length; i++) expect(strip[i - 1]!.date <= strip[i]!.date).toBe(true);
      const q = qualityWins(WEEK, t.slug);
      let top10 = 0;
      for (const gm of t.games) if (gm.oppFbs && gm.result === 'W' && WEEK.teams[gm.opp]!.ranks.fei <= 10) top10++;
      expect(q.top10.w).toBe(top10);
    }
  });

  it('throws on unknown teams', () => {
    expect(() => gameRows(WEEK, 'nope')).toThrow();
  });
});

describe('head-to-head', () => {
  const strongest = Object.values(WEEK.teams)
    .slice()
    .sort((a, b) => b.values.fei - a.values.fei);
  // The fixture's triangle is the three strongest by hidden strength; find it from the games.
  const triangle = (() => {
    const slugs = Object.keys(WEEK.teams);
    for (const a of slugs) for (const b of slugs) for (const c of slugs) {
      if (a < b && b < c && headToHead(WEEK, a, b).length && headToHead(WEEK, b, c).length && headToHead(WEEK, a, c).length) return [a, b, c];
    }
    return null;
  })();

  it('finds a trio where all three played each other', () => {
    expect(triangle).not.toBeNull();
    expect(strongest.length).toBeGreaterThan(3);
  });

  it('lists every meeting with winner, margin and the winner-side site', () => {
    const [a, b, c] = triangle!;
    const flags = trioHeadToHead(WEEK, [a!, b!, c!]);
    expect(flags.length).toBeGreaterThanOrEqual(3);
    for (const f of flags) {
      expect([a, b, c]).toContain(f.winner);
      expect([a, b, c]).toContain(f.loser);
      expect(f.margin).toBe(f.winnerPoints - f.loserPoints);
      expect(f.margin).toBeGreaterThan(0);
      const wg = WEEK.teams[f.winner]!.games.find((g) => g.opp === f.loser && g.week === f.week)!;
      expect(wg.result).toBe('W');
      expect(wg.site).toBe(f.winnerSite);
    }
    // symmetric
    expect(headToHead(WEEK, a!, b!)).toEqual(headToHead(WEEK, b!, a!));
    for (let i = 1; i < flags.length; i++) expect(flags[i - 1]!.date <= flags[i]!.date).toBe(true);
  });

  it('is empty for teams that never met, and falls back to the other side\'s list', () => {
    const slugs = Object.keys(WEEK.teams);
    const a = slugs[0]!;
    const never = slugs.find((s) => s !== a && !WEEK.teams[a]!.games.some((g) => g.opp === s))!;
    expect(headToHead(WEEK, a, never)).toEqual([]);
    const w: WeekFile = structuredClone(WEEK);
    const [x, y] = triangle!;
    w.teams[x!]!.games = w.teams[x!]!.games.filter((g) => g.opp !== y);
    expect(headToHead(w, x!, y!)).toEqual(headToHead(WEEK, x!, y!));
  });
});

describe('pool, prior, orders and deltas', () => {
  it('gwdOrder sorts by GWD rank with deterministic ties', () => {
    const o = gwdOrder(WEEK);
    expect(o).toHaveLength(138);
    for (let i = 1; i < o.length; i++) {
      const a = WEEK.teams[o[i - 1]!]!;
      const b = WEEK.teams[o[i]!]!;
      expect(a.ranks.sor).toBeLessThanOrEqual(b.ranks.sor);
      if (a.ranks.sor === b.ranks.sor) expect(a.values.gwd >= b.values.gwd).toBe(true);
    }
  });

  it('with a committee: prior = committee, then GWD top 25 not ranked, in GWD order; pool = union', () => {
    const p = prior(WEEK);
    expect(p.slice(0, 25)).toEqual(WEEK.committee);
    const gwdTop = gwdOrder(WEEK).filter((s) => WEEK.teams[s]!.ranks.sor <= 25);
    expect(p.slice(25)).toEqual(gwdTop.filter((s) => !WEEK.committee!.includes(s)));
    expect(new Set(pool(WEEK))).toEqual(new Set([...WEEK.committee!, ...gwdTop]));
    expect(new Set(p).size).toBe(p.length);
  });

  it('without a committee: prior = GWD top 25 (ties at 25 included)', () => {
    const p = prior(NO_COMMITTEE);
    const expected = gwdOrder(NO_COMMITTEE).filter((s) => NO_COMMITTEE.teams[s]!.ranks.sor <= 25);
    expect(p).toEqual(expected);
    expect(p.length).toBeGreaterThanOrEqual(25);
    // force a tie at 25
    const w: WeekFile = structuredClone(NO_COMMITTEE);
    const at26 = Object.values(w.teams).find((t) => t.ranks.sor === 26);
    if (at26) {
      at26.ranks.sor = 25;
      expect(prior(w)).toContain(at26.slug);
    }
  });

  it('deltas are committee minus GWD rank, null when unranked', () => {
    for (const d of deltas(WEEK)) {
      const t = WEEK.teams[d.slug]!;
      expect(d.gwd).toBe(t.ranks.sor);
      expect(d.delta).toBe(t.ranks.committee === null ? null : t.ranks.committee - t.ranks.sor);
    }
  });

  it('throws when the committee names an unknown team', () => {
    const w: WeekFile = structuredClone(WEEK);
    w.committee![0] = 'ghost';
    expect(() => prior(w)).toThrow(/ghost/);
  });
});

describe('content derivations', () => {
  it('bubble: committee 8-20 sorted by GWD rank', () => {
    const b = bubble(WEEK);
    expect(b).toHaveLength(13);
    expect(new Set(b.map((r) => r.committee))).toEqual(new Set(Array.from({ length: 13 }, (_, i) => i + 8)));
    for (let i = 1; i < b.length; i++) expect(b[i - 1]!.gwd).toBeLessThanOrEqual(b[i]!.gwd);
    for (const r of b) expect(r.delta).toBe(r.committee! - r.gwd);
    expect(bubble(NO_COMMITTEE)).toEqual([]);
    expect(bubble(WEEK, { from: 1, to: 4 })).toHaveLength(4);
  });

  it('comparePairs: C(25,2) = 300 pairs, better committee rank first, unique slugs', () => {
    const pairs = comparePairs(WEEK);
    expect(pairs).toHaveLength(300);
    expect(new Set(pairs.map((p) => p.slug)).size).toBe(300);
    for (const p of pairs) {
      expect(p.aRank).toBeLessThan(p.bRank);
      expect(WEEK.committee![p.aRank - 1]).toBe(p.a);
      expect(p.slug).toBe(`${p.a}-vs-${p.b}`);
    }
    expect(comparePairs(NO_COMMITTEE)).toEqual([]);
  });

  it('nearestCompares: closest committee neighbors, better-ranked first on ties', () => {
    const c = WEEK.committee!;
    const ranksOf = (slug: string) => nearestCompares(WEEK, slug).map((p) => (p.a === slug ? p.bRank : p.aRank));
    expect(ranksOf(c[0]!)).toEqual([2, 3, 4]);
    expect(ranksOf(c[9]!)).toEqual([9, 11, 8]);
    expect(ranksOf(c[24]!)).toEqual([24, 23, 22]);
    const pairSlugs = new Set(comparePairs(WEEK).map((p) => p.slug));
    for (const p of nearestCompares(WEEK, c[9]!)) expect(pairSlugs.has(p.slug)).toBe(true);
    const unranked = Object.keys(WEEK.teams).find((s) => !c.includes(s))!;
    expect(nearestCompares(WEEK, unranked)).toEqual([]);
    expect(nearestCompares(NO_COMMITTEE, Object.keys(NO_COMMITTEE.teams)[0]!)).toEqual([]);
    expect(nearestCompares(WEEK, c[5]!, 5)).toHaveLength(5);
  });

  it('conferenceStandings: sorted tables, leaders at the best conference pct, no independents champion', () => {
    const st = conferenceStandings(WEEK);
    expect(st.map((s) => s.conference)).toEqual([...st.map((s) => s.conference)].sort());
    for (const s of st) {
      for (let i = 1; i < s.teams.length; i++) expect(s.teams[i - 1]!.confPct).toBeGreaterThanOrEqual(s.teams[i]!.confPct);
      if (s.conference === INDEPENDENTS) {
        expect(s.crownsChampion).toBe(false);
        expect(s.leaders).toEqual([]);
      } else {
        expect(s.leaders.length).toBeGreaterThanOrEqual(1);
        for (const l of s.leaders) expect(s.teams.find((t) => t.slug === l)!.confPct).toBe(s.teams[0]!.confPct);
      }
    }
    expect(st.reduce((n, s) => n + s.teams.length, 0)).toBe(138);
  });
});

describe('data-node loaders', () => {
  const root = mkdtempSync(join(tmpdir(), 'cfb-data-'));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  const w8 = makeWeek({ seed: 8, weeks: 8, committee: false, nTeams: 40 });
  const w9 = makeWeek({ seed: 9, weeks: 9, nTeams: 40 });
  mkdirSync(join(root, '2026'), { recursive: true });
  writeFileSync(join(root, '2026', 'week-8.json'), JSON.stringify(w8));
  writeFileSync(join(root, '2026', 'week-9.json'), JSON.stringify(w9));
  mkdirSync(join(root, '2025'), { recursive: true });
  writeFileSync(join(root, '2025', 'week-15.json'), JSON.stringify({ ...w9, season: 2025, week: 15 }));

  it('loads weeks and rebuilds a missing index from the files', () => {
    expect(loadWeek(2026, 9, { dataDir: root }).week).toBe(9);
    const idx = loadSeasonIndex(2026, { dataDir: root });
    expect(idx.weeks.map((w) => [w.week, w.hasCommittee])).toEqual([
      [8, false],
      [9, true],
    ]);
    expect(loadAllWeeks(2026, { dataDir: root }).map((w) => w.week)).toEqual([8, 9]);
    expect(loadLatest({ dataDir: root }).season).toBe(2026);
    expect(loadLatest({ dataDir: root }).week).toBe(9);
  });

  it('uses $CFB_DATA_DIR when no dataDir option is given; opts.dataDir still wins', () => {
    const before = process.env.CFB_DATA_DIR;
    process.env.CFB_DATA_DIR = root;
    try {
      expect(dataDir()).toBe(resolve(root));
      const latest = loadLatest();
      expect([latest.season, latest.week, latest.fbsCount]).toEqual([2026, 9, 40]); // the 40-team fixture, not /data
      expect(loadWeek(2025, 15).season).toBe(2025); // only exists under root
      expect(loadAllWeeks(2026).map((w) => w.week)).toEqual([8, 9]);
      expect(() => loadLatest({ dataDir: join(root, 'empty') })).toThrow();
    } finally {
      if (before === undefined) delete process.env.CFB_DATA_DIR;
      else process.env.CFB_DATA_DIR = before;
    }
  });

  it('prefers index.json when present and sorts it', () => {
    writeFileSync(
      join(root, '2026', 'index.json'),
      JSON.stringify({ season: 2026, weeks: [{ week: 9, asOf: 'x', label: 'After Week 9', hasCommittee: true }, { week: 8, asOf: 'y', label: 'After Week 8', hasCommittee: false }] }),
    );
    expect(loadSeasonIndex(2026, { dataDir: root }).weeks.map((w) => w.week)).toEqual([8, 9]);
  });

  it('fails loudly on missing files and schema mismatches', () => {
    expect(() => loadWeek(2026, 3, { dataDir: root })).toThrow(/not found/);
    // Only schemaVersion 2 loads: a v1 file (single `playoff`) and an unknown future version both fail.
    expect(w8.schemaVersion).toBe(2);
    const { playoffFormats, ...rest } = w8;
    writeFileSync(join(root, '2026', 'week-2.json'), JSON.stringify({ ...rest, schemaVersion: 1, playoff: playoffFormats[0] }));
    expect(() => loadWeek(2026, 2, { dataDir: root })).toThrow(/schemaVersion 1 \(expected 2\)/);
    writeFileSync(join(root, '2026', 'week-2.json'), JSON.stringify({ ...w8, schemaVersion: 3 }));
    expect(() => loadWeek(2026, 2, { dataDir: root })).toThrow(/schemaVersion 3 \(expected 2\)/);
    expect(() => loadSeasonIndex(1999, { dataDir: root })).toThrow();
    expect(() => loadLatest({ dataDir: join(root, 'empty') })).toThrow();
  });
});
