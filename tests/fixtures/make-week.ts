/**
 * Synthetic, internally consistent WeekFiles for tests (fixtures only; never shipped).
 * - every FBS-vs-FBS game is mirrored on both teams with flipped site / score;
 * - some teams play FCS (and occasionally Division II) opponents;
 * - FEI and GWD ranks contain deliberate ties;
 * - committee top 25 present or absent; it disagrees with GWD order on purpose;
 * - one independent is slugged "notre-dame" so the guaranteed-bid rule can be exercised.
 */
import { mulberry32, shuffled, type Rng } from '../../src/lib/rng';
import type { Game, Opponent, PlayoffFormat, Team, WeekFile } from '../../src/lib/types';

export interface MakeWeekOptions {
  seed?: number;
  /** FBS team count (default 138). */
  nTeams?: number;
  season?: number;
  /** Weeks of games (default 9). */
  weeks?: number;
  /** Include a committee top 25 (default true). */
  committee?: boolean;
  /** Committee list length (default 25). */
  committeeSize?: number;
  /** Real conferences (default 10); independents go to "FBS Independents". */
  conferences?: number;
  /** Independent teams (default 3, the first is "notre-dame"). */
  independents?: number;
  /** Share of teams with one non-FBS game (default 0.7). */
  fcsShare?: number;
  /** Force some equal ranks in sor/fei (default true). */
  rankTies?: boolean;
  champions?: Record<string, string>;
  /** Make the three strongest teams all play each other (default true). */
  triangle?: boolean;
}

export const INDEPENDENTS = 'FBS Independents';

export const PLAYOFF_2026: PlayoffFormat = {
  size: 12,
  byes: 4,
  seeding: 'straight',
  autoBids: { conferenceChampions: 5, guaranteed: [{ slug: 'notre-dame', ifRankedAtOrAbove: 12 }] },
  nonConferences: [INDEPENDENTS],
  sourceUrl: 'https://collegefootballplayoff.com/format',
};

const pad = (n: number, w = 3): string => String(n).padStart(w, '0');
const hex = (rng: Rng): string =>
  '#' +
  Math.floor(rng() * 0xffffff)
    .toString(16)
    .padStart(6, '0');
const logistic = (x: number): number => 1 / (1 + Math.exp(-x));
function gauss(rng: Rng): number {
  const u = Math.max(rng(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

/** Competition ranking ("1224") of values, higher value = better, ties share a rank. */
function rankDesc(values: number[]): number[] {
  const idx = values.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v || a.i - b.i);
  const ranks = new Array<number>(values.length);
  idx.forEach((o, k) => {
    ranks[o.i] = k > 0 && o.v === idx[k - 1]!.v ? ranks[idx[k - 1]!.i]! : k + 1;
  });
  return ranks;
}

/** Build a valid WeekFile. Same options -> same file. */
export function makeWeek(opts: MakeWeekOptions = {}): WeekFile {
  const rng = mulberry32(opts.seed ?? 1);
  const n = opts.nTeams ?? 138;
  const season = opts.season ?? 2026;
  const nWeeks = opts.weeks ?? 9;
  const nConf = opts.conferences ?? 10;
  const nInd = Math.min(opts.independents ?? 3, n);
  const fcsShare = opts.fcsShare ?? 0.7;
  const ties = opts.rankTies ?? true;

  const slugs: string[] = [];
  const confOf: string[] = [];
  for (let i = 0; i < n; i++) {
    const independent = i >= n - nInd;
    slugs.push(independent && i === n - nInd ? 'notre-dame' : `team-${pad(i + 1)}`);
    confOf.push(independent ? INDEPENDENTS : `Conf ${String.fromCharCode(65 + (i % nConf))}`);
  }
  const strength = slugs.map(() => gauss(rng));
  const games: Game[][] = slugs.map(() => []);
  const opponents: Record<string, Opponent> = {};
  const played = new Set<string>();
  const pk = (a: number, b: number): string => (a < b ? `${a}-${b}` : `${b}-${a}`);
  const busy = (w: number, i: number): boolean => games[i]!.some((g) => g.week === w);
  const dateFor = (w: number, dayOffset: number): string => {
    const d = new Date(Date.UTC(season, 7, 29 + 7 * (w - 1) + dayOffset));
    return d.toISOString().slice(0, 10);
  };

  const playGame = (w: number, a: number, b: number): void => {
    const r = rng();
    const site: 'home' | 'neutral' = r < 0.06 ? 'neutral' : 'home'; // a's site; a is home unless neutral
    const adv = site === 'home' ? 0.3 : 0;
    const aWins = rng() < logistic(strength[a]! - strength[b]! + adv);
    const win = 17 + Math.floor(rng() * 32);
    const margin = 1 + Math.floor(rng() * 30);
    const lose = Math.max(0, win - margin);
    const conf = confOf[a] === confOf[b] && confOf[a] !== INDEPENDENTS;
    const date = dateFor(w, rng() < 0.15 ? -2 : 0);
    const [pfA, paA] = aWins ? [win, lose] : [lose, win];
    games[a]!.push({ week: w, date, opp: slugs[b]!, oppFbs: true, site, pf: pfA, pa: paA, result: aWins ? 'W' : 'L', conf });
    games[b]!.push({
      week: w,
      date,
      opp: slugs[a]!,
      oppFbs: true,
      site: site === 'neutral' ? 'neutral' : 'away',
      pf: paA,
      pa: pfA,
      result: aWins ? 'L' : 'W',
      conf,
    });
    played.add(pk(a, b));
  };

  // Strongest three teams form a triangle in weeks 1-3.
  const byStrength = slugs.map((_, i) => i).sort((x, y) => strength[y]! - strength[x]!);
  if ((opts.triangle ?? true) && n >= 3) {
    const [x, y, z] = [byStrength[0]!, byStrength[1]!, byStrength[2]!];
    playGame(1, x, y);
    playGame(2, y, z);
    playGame(3, z, x);
  }
  // Non-FBS games in weeks 1-3.
  let nonFbs = 0;
  for (let i = 0; i < n; i++) {
    if (rng() >= fcsShare) continue;
    let w = 1 + Math.floor(rng() * 3);
    if (busy(w, i)) w = [1, 2, 3].find((x) => !busy(x, i)) ?? 0;
    if (!w) continue;
    nonFbs++;
    const cls = nonFbs % 9 === 0 ? 'ii' : 'fcs';
    const os = `${cls === 'fcs' ? 'fcs' : 'd2'}-${pad(nonFbs)}`;
    opponents[os] = { slug: os, name: `${cls === 'fcs' ? 'FCS' : 'D-II'} School ${pad(nonFbs)}`, classification: cls };
    const pf = 28 + Math.floor(rng() * 30);
    const pa = Math.floor(rng() * 20);
    games[i]!.push({ week: w, date: dateFor(w, 0), opp: os, oppFbs: false, site: 'home', pf, pa: Math.min(pa, pf - 1), result: 'W', conf: false });
  }
  // FBS schedule: random pairings, conference games preferred from week 4.
  for (let w = 1; w <= nWeeks; w++) {
    const order = shuffled(
      slugs.map((_, i) => i).filter((i) => !busy(w, i)),
      rng,
    );
    const free = new Set(order);
    for (const a of order) {
      if (!free.has(a)) continue;
      free.delete(a);
      if (rng() < 0.1) continue; // bye
      const cands = [...free].filter((b) => !played.has(pk(a, b)));
      const conf = w >= 4 ? cands.filter((b) => confOf[b] === confOf[a] && confOf[a] !== INDEPENDENTS) : [];
      const pool = conf.length ? conf : cands;
      if (!pool.length) continue;
      const b = pool[Math.floor(rng() * pool.length)]!;
      free.delete(b);
      playGame(w, a, b);
    }
  }
  for (const g of games) g.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : x.week - y.week));

  // Ratings.
  const feiVal = strength.map((s) => Math.round((s + 0.15 * gauss(rng)) * 100) / 100);
  const good = 0.8;
  const gwdVal = games.map((gs) => {
    let v = 0;
    for (const g of gs) {
      const os = g.oppFbs ? strength[slugs.indexOf(g.opp)]! : -2.5;
      v += (g.result === 'W' ? 1 : 0) - logistic(good - os);
    }
    return Math.round(v * 100) / 100;
  });
  const feiRank = rankDesc(feiVal);
  const sorRank = rankDesc(gwdVal);
  if (ties) {
    // Force a few ties: the team ranked k+1 shares rank k.
    for (const k of [7, 25, 40]) {
      const a = sorRank.indexOf(k + 1);
      if (a >= 0 && sorRank.indexOf(k) >= 0) sorRank[a] = k;
      const b = feiRank.indexOf(k + 1);
      if (b >= 0 && feiRank.indexOf(k) >= 0) feiRank[b] = k;
    }
  }
  const offRank = rankDesc(strength.map((s) => s + gauss(rng)));
  const defRank = rankDesc(strength.map((s) => s + gauss(rng)));
  const elsVal = games.map((gs) => {
    let v = 0;
    for (const g of gs) v += g.oppFbs ? strength[slugs.indexOf(g.opp)]! + 3 : 0;
    return Math.round(v * 100) / 100;
  });
  const sosRank = rankDesc(elsVal);

  // Committee: noisy GWD.
  const committeeOn = opts.committee ?? true;
  const cSize = Math.min(opts.committeeSize ?? 25, n);
  const committee = committeeOn
    ? slugs
        .map((s, i) => ({ s, v: gwdVal[i]! + 0.6 * gauss(rng) + 0.4 * strength[i]! }))
        .sort((a, b) => b.v - a.v || (a.s < b.s ? -1 : 1))
        .slice(0, cSize)
        .map((o) => o.s)
    : null;

  const teams: Record<string, Team> = {};
  slugs.forEach((slug, i) => {
    const gs = games[i]!;
    const w = gs.filter((g) => g.result === 'W').length;
    const cw = gs.filter((g) => g.conf && g.result === 'W').length;
    const cl = gs.filter((g) => g.conf && g.result === 'L').length;
    teams[slug] = {
      slug,
      id: 1000 + i,
      name: slug === 'notre-dame' ? 'Notre Dame' : `Team ${pad(i + 1)}`,
      short: slug === 'notre-dame' ? 'ND' : `T${pad(i + 1)}`,
      mascot: null,
      conference: confOf[i]!,
      colors: { primary: hex(rng), secondary: hex(rng) },
      record: { w, l: gs.length - w },
      confRecord: { w: cw, l: cl },
      ranks: {
        sor: sorRank[i]!,
        sos: sosRank[i]!,
        off: offRank[i]!,
        def: defRank[i]!,
        fei: feiRank[i]!,
        committee: committee ? (committee.indexOf(slug) >= 0 ? committee.indexOf(slug) + 1 : null) : null,
      },
      values: { fei: feiVal[i]!, ofei: Math.round(gauss(rng) * 100) / 100, dfei: Math.round(gauss(rng) * 100) / 100, gwd: gwdVal[i]!, els: elsVal[i]! },
      games: gs,
    };
  });

  return {
    schemaVersion: 1,
    season,
    week: nWeeks,
    asOf: '2026-11-05',
    label: `After Week ${nWeeks}`,
    sources: {
      ratings: { name: 'FEI', author: 'Brian Fremeau', url: `https://bcftoys.com/${season}-fei`, throughWeek: nWeeks },
      games: { name: 'CollegeFootballData.com', url: 'https://collegefootballdata.com' },
      committee: committeeOn
        ? { name: 'College Football Playoff Selection Committee', url: 'https://collegefootballplayoff.com/rankings', releaseDate: '2026-11-03' }
        : null,
    },
    playoff: PLAYOFF_2026,
    fbsCount: n,
    teams,
    opponents,
    committee,
    ...(opts.champions ? { champions: opts.champions } : {}),
  };
}

/** Consistency problems in a WeekFile (empty = consistent). Used to prove fixtures are valid. */
export function weekProblems(week: WeekFile): string[] {
  const out: string[] = [];
  if (Object.keys(week.teams).length !== week.fbsCount) out.push('fbsCount mismatch');
  for (const t of Object.values(week.teams)) {
    let w = 0;
    let cw = 0;
    let cl = 0;
    for (const g of t.games) {
      if (g.result === 'W') w++;
      if (g.conf) g.result === 'W' ? cw++ : cl++;
      if ((g.pf > g.pa) !== (g.result === 'W')) out.push(`${t.slug} w${g.week}: result vs score`);
      if (g.oppFbs) {
        const o = week.teams[g.opp];
        if (!o) {
          out.push(`${t.slug}: unknown FBS opp ${g.opp}`);
          continue;
        }
        const m = o.games.filter((x) => x.week === g.week && x.opp === t.slug && x.oppFbs);
        if (m.length !== 1) out.push(`${t.slug} w${g.week}: not mirrored`);
        else {
          const x = m[0]!;
          const site = g.site === 'home' ? 'away' : g.site === 'away' ? 'home' : 'neutral';
          if (x.pf !== g.pa || x.pa !== g.pf || x.site !== site || x.result === g.result || x.date !== g.date || x.conf !== g.conf) {
            out.push(`${t.slug} w${g.week}: mirror mismatch`);
          }
        }
      } else if (!week.opponents[g.opp]) out.push(`${t.slug}: unknown opponent ${g.opp}`);
    }
    if (w !== t.record.w || t.games.length - w !== t.record.l) out.push(`${t.slug}: record`);
    if (cw !== t.confRecord.w || cl !== t.confRecord.l) out.push(`${t.slug}: confRecord`);
  }
  if (week.committee) {
    week.committee.forEach((s, i) => {
      if (week.teams[s]?.ranks.committee !== i + 1) out.push(`committee rank of ${s}`);
    });
  }
  return out;
}

/** A synthetic prior of `n` slugs with GWD ranks that partly disagree with it. */
export function makePrior(n: number, seed: number, opts: { committee?: boolean } = {}): { prior: string[]; gwdRank: Record<string, number> } {
  const rng = mulberry32(seed);
  const prior = Array.from({ length: n }, (_, i) => `p${pad(i + 1, 2)}`);
  const gwdRank: Record<string, number> = {};
  if (opts.committee === false) {
    prior.forEach((s, i) => (gwdRank[s] = i + 1));
  } else {
    const noisy = prior.map((s, i) => ({ s, v: i + 4 * gauss(rng) })).sort((a, b) => a.v - b.v);
    noisy.forEach((o, i) => (gwdRank[o.s] = i + 1));
  }
  return { prior, gwdRank };
}
