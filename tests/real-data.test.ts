/**
 * Checks against the real pipeline output: every committed week file (so the weekly data Action
 * tests each new week before it reaches main), with the slow criterion-7 sweep on the newest week.
 * Skipped when /data has no week files.
 */
import { describe, expect, it } from 'vitest';
import { comparePairs, gwdOrder } from '../src/lib/data';
import { listSeasons, loadSeasonIndex, loadWeek } from '../src/lib/data-node';
import { buildGameData, computeRunResults, gameTrioState } from '../src/lib/game-data';
import { computePlayoff, nonPoolLeaders, playoffContext } from '../src/lib/playoff';
import { rngForRound } from '../src/lib/rng';
import { isValidRun, nextTrio } from '../src/lib/trios';

function committedWeeks(): [number, number][] {
  try {
    return listSeasons().flatMap((season) => loadSeasonIndex(season).weeks.map((w): [number, number] => [season, w.week]));
  } catch {
    return [];
  }
}

const WEEKS = committedWeeks();
const LATEST = WEEKS[WEEKS.length - 1];

describe.skipIf(!WEEKS.length).each(WEEKS)('real data: data/%i/week-%i.json', (season, wk) => {
  const week = loadWeek(season, wk);
  const gd = buildGameData(week);
  const isLatest = LATEST?.[0] === season && LATEST?.[1] === wk;

  it('pool = committee top 25 ∪ GWD top 25', () => {
    const gwdTop = gwdOrder(week).filter((s) => week.teams[s]!.ranks.sor <= 25);
    const expected = new Set([...(week.committee ?? []), ...gwdTop]);
    expect(new Set(gd.prior)).toEqual(expected);
    expect(gd.prior.length).toBeGreaterThanOrEqual(25);
    expect(gd.prior.length).toBeLessThanOrEqual(50);
    if (week.committee) {
      expect(gd.prior.slice(0, 25)).toEqual(week.committee);
      expect(comparePairs(week)).toHaveLength(300);
    }
    expect(gd.slugs).toHaveLength(week.fbsCount);
  });

  it('game data has no forbidden strings and is small', () => {
    const json = JSON.stringify(gd);
    expect(json).not.toMatch(/ESPN|FPI|SP\+|Game Control/i);
    // eslint-disable-next-line no-console
    console.log(`game-data ${gd.season}-${gd.week}.json: ${Buffer.byteLength(json)} bytes, pool ${gd.prior.length}, leaders ${gd.leaders.length}`);
    expect(Buffer.byteLength(json)).toBeLessThan(80_000);
  });

  it('non-pool conference leaders are the champions outside the pool, in GWD order', () => {
    const ctx = playoffContext(week);
    const pool = new Set(gd.prior);
    const res = computePlayoff(gd.prior, ctx);
    const outside = res.champions.map((c) => c.slug).filter((s) => !pool.has(s));
    const sor = (s: string): number => week.teams[s]!.ranks.sor;
    const expected = [...outside].sort((a, b) => sor(a) - sor(b) || (a < b ? -1 : a > b ? 1 : 0));
    expect(nonPoolLeaders(gd.prior, ctx)).toEqual(expected);
    expect(gd.leaders).toEqual(expected);
    expect(res.order.slice(gd.prior.length)).toEqual(expected);
    // eslint-disable-next-line no-console
    console.log(`non-pool leaders: ${expected.map((s) => `${s} (GWD ${sor(s)})`).join(', ')}`);
  });

  it.runIf(isLatest)('criterion 7 on the real pool: prior-following runs reproduce the committee top 25', () => {
    const pos = new Map(gd.prior.map((s, i) => [s, i]));
    for (let seed = 0; seed < 100; seed++) {
      const rounds: string[][] = [];
      const total = seed % 10 === 0 ? 30 : 15;
      for (let r = 1; r <= total; r++) {
        const t = nextTrio(gameTrioState(gd, rounds), rngForRound(seed, r));
        expect(t).not.toBeNull();
        rounds.push([...t!].sort((a, b) => pos.get(a)! - pos.get(b)!));
      }
      expect(isValidRun(rounds, gd.prior)).toBe(true);
      const res = computeRunResults(gd, rounds);
      expect(res.ranking.order).toEqual(gd.prior);
      if (gd.committee) expect(res.ranking.order.slice(0, 25)).toEqual(gd.committee);
      for (const f of week.playoffFormats) {
        expect(res.playoffs[f.id]!.field).toHaveLength(f.size);
        expect(res.playoffs[f.id]!.firstFiveOut).toHaveLength(5);
      }
    }
  }, 120_000);
});

describe.skipIf(!LATEST)('remaining schedule (upcomingRows) on the newest week', () => {
  it('lists every scheduled game chronologically with the opponent tier and committee rank', async () => {
    const { upcomingRows } = await import('../src/lib/data');
    const week = loadWeek(LATEST![0], LATEST![1]);
    let total = 0;
    for (const slug of Object.keys(week.teams)) {
      const rows = upcomingRows(week, slug);
      if (!week.teams[slug]!.upcoming) {
        expect(rows).toBeNull();
        continue;
      }
      expect(rows).toHaveLength(week.teams[slug]!.upcoming!.length);
      total += rows!.length;
      const dates = rows!.map((r) => r.date);
      expect(dates).toEqual([...dates].sort());
      for (const r of rows!) {
        expect(r.week).toBeGreaterThan(week.week);
        if (r.opp.fbs) expect(r.oppCommittee).toBe(week.teams[r.opp.slug]!.ranks.committee);
        else expect(['FCS team', 'Non-FBS team']).toContain(r.tier.label);
      }
    }
    // eslint-disable-next-line no-console
    console.log(`upcoming: ${total} team-games after week ${week.week}`);
  });
});
