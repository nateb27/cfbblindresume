/**
 * Pure derivations on a WeekFile (SPEC "data.ts"). No I/O. Every function is deterministic and
 * throws an Error on inconsistent data (unknown team / opponent) so a bad file fails the build
 * loudly instead of rendering guesses.
 */
import type { Game, Result, Site, Team, WeekFile } from './types';
import { tierFor, type Tier } from './tiers';
import { committeeOrder, gwdOrder, pool, prior } from './pool';

export { committeeOrder, gwdOrder, pool, prior, gwdTop, positions, TOP_N } from './pool';

/** Wins and losses. */
export interface WL {
  w: number;
  l: number;
}

/** An opponent as shown in a game row. */
export interface OpponentRef {
  slug: string;
  name: string;
  fbs: boolean;
  /** Current-week overall FEI rank (FBS only). */
  feiRank: number | null;
  /** CFBD classification for non-FBS opponents ('fcs', 'ii', ...), null for FBS. */
  classification: string | null;
  /** Conference for FBS opponents, null otherwise. */
  conference: string | null;
}

/** One completed game from a team's point of view, with the opponent's current tier. */
export interface GameRow {
  week: number;
  date: string;
  opp: OpponentRef;
  tier: Tier;
  site: Site;
  result: Result;
  pf: number;
  pa: number;
  /** pf - pa (positive for wins). */
  margin: number;
  conf: boolean;
}

/** A dot on the resume strip (chronological). */
export interface StripEntry {
  week: number;
  date: string;
  result: Result;
  tier: Tier;
  /** pf - pa. */
  margin: number;
  site: Site;
}

/** Records against opponents by current FEI rank bucket. */
export interface QualityWins {
  /** vs FEI 1-10. */
  top10: WL;
  /** vs FEI 11-25. */
  r11to25: WL;
  /** vs FEI 26-50. */
  r26to50: WL;
}

/** One meeting between two FBS teams. */
export interface H2HGame {
  week: number;
  date: string;
  winner: string;
  loser: string;
  winnerPoints: number;
  loserPoints: number;
  /** winnerPoints - loserPoints (>= 0). */
  margin: number;
  /** Site from the winner's point of view. */
  winnerSite: Site;
}

/** Committee-vs-FEI comparison for one team. */
export interface DeltaRow {
  slug: string;
  committee: number | null;
  /** FEI GWD rank. */
  gwd: number;
  /** committee - gwd (positive: the committee ranks the team lower than FEI does); null if unranked. */
  delta: number | null;
}

/** A compare page pair. `a` has the better committee rank. */
export interface ComparePair {
  a: string;
  b: string;
  aRank: number;
  bRank: number;
  /** URL slug "a-vs-b" (route /compare/{slug}). */
  slug: string;
}

/** One team's line in a conference table. */
export interface StandingRow {
  slug: string;
  confRecord: WL;
  record: WL;
  /** Conference win pct (0 when no conference games). */
  confPct: number;
  /** FEI GWD rank. */
  gwd: number;
}

/** One conference's standings. */
export interface ConferenceStanding {
  conference: string;
  /** False for entries in playoff.nonConferences (e.g. "FBS Independents"). */
  crownsChampion: boolean;
  /** Actual champion from week.champions, or null. */
  champion: string | null;
  /** Teams tied for the best conference win pct (table order); empty when !crownsChampion. */
  leaders: string[];
  /** Sorted: conf pct desc, conf wins desc, overall pct desc, GWD rank asc, slug. */
  teams: StandingRow[];
}

const cmpStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** w / (w + l), or 0 when no games. */
export function winPct(w: number, l: number): number {
  return w + l === 0 ? 0 : w / (w + l);
}

/** Team by slug. @throws Error if unknown. */
export function team(week: WeekFile, slug: string): Team {
  const t = week.teams[slug];
  if (!t) throw new Error(`unknown FBS team "${slug}"`);
  return t;
}

/** All FBS teams sorted by name (code-unit order, then slug). */
export function teamList(week: WeekFile): Team[] {
  return Object.values(week.teams).sort((a, b) => cmpStr(a.name, b.name) || cmpStr(a.slug, b.slug));
}

/** Every FBS slug sorted ascending: the share-code index space. */
export function fbsSlugsSorted(week: WeekFile): string[] {
  return Object.keys(week.teams).sort(cmpStr);
}

/** Resolve a game's opponent. @throws Error on a dangling reference. */
export function opponentOf(week: WeekFile, g: Game): OpponentRef {
  if (g.oppFbs) {
    const t = week.teams[g.opp];
    if (!t) throw new Error(`game references unknown FBS team "${g.opp}"`);
    return { slug: t.slug, name: t.name, fbs: true, feiRank: t.ranks.fei, classification: null, conference: t.conference };
  }
  const o = week.opponents[g.opp];
  if (!o) throw new Error(`game references unknown non-FBS opponent "${g.opp}"`);
  return { slug: o.slug, name: o.name, fbs: false, feiRank: null, classification: o.classification, conference: null };
}

function rowFor(week: WeekFile, g: Game): GameRow {
  const opp = opponentOf(week, g);
  const tier = tierFor({ fbs: opp.fbs, feiRank: opp.feiRank ?? undefined, classification: opp.classification ?? undefined });
  return { week: g.week, date: g.date, opp, tier, site: g.site, result: g.result, pf: g.pf, pa: g.pa, margin: g.pf - g.pa, conf: g.conf };
}

/**
 * A team's game log, toughest first: tier order asc, then opponent FEI rank asc (FBS), then date
 * asc, then week, then opponent slug.
 */
export function gameRows(week: WeekFile, slug: string): GameRow[] {
  const rows = team(week, slug).games.map((g) => rowFor(week, g));
  rows.sort(
    (a, b) =>
      a.tier.order - b.tier.order ||
      (a.opp.feiRank ?? 0) - (b.opp.feiRank ?? 0) ||
      cmpStr(a.date, b.date) ||
      a.week - b.week ||
      cmpStr(a.opp.slug, b.opp.slug),
  );
  return rows;
}

/** A team's games in chronological order (date, then week) as strip dots. */
export function resumeStrip(week: WeekFile, slug: string): StripEntry[] {
  const rows = team(week, slug).games.map((g) => rowFor(week, g));
  rows.sort((a, b) => cmpStr(a.date, b.date) || a.week - b.week);
  return rows.map((r) => ({ week: r.week, date: r.date, result: r.result, tier: r.tier, margin: r.margin, site: r.site }));
}

/** Records vs FEI 1-10, 11-25 and 26-50 (current ranks). */
export function qualityWins(week: WeekFile, slug: string): QualityWins {
  const q: QualityWins = { top10: { w: 0, l: 0 }, r11to25: { w: 0, l: 0 }, r26to50: { w: 0, l: 0 } };
  for (const g of team(week, slug).games) {
    if (!g.oppFbs) continue;
    const r = team(week, g.opp).ranks.fei;
    const bucket = r <= 10 ? q.top10 : r <= 25 ? q.r11to25 : r <= 50 ? q.r26to50 : null;
    if (!bucket) continue;
    if (g.result === 'W') bucket.w++;
    else bucket.l++;
  }
  return q;
}

const flipSite = (s: Site): Site => (s === 'home' ? 'away' : s === 'away' ? 'home' : 'neutral');

/**
 * Every game between FBS teams a and b (chronological), from a's game list (falling back to b's
 * if a lists none).
 */
export function headToHead(week: WeekFile, a: string, b: string): H2HGame[] {
  const fromA = team(week, a).games.filter((g) => g.oppFbs && g.opp === b);
  const src: { self: string; opp: string; games: Game[] } =
    fromA.length > 0 ? { self: a, opp: b, games: fromA } : { self: b, opp: a, games: team(week, b).games.filter((g) => g.oppFbs && g.opp === a) };
  return src.games
    .map((g): H2HGame => {
      const won = g.result === 'W';
      return {
        week: g.week,
        date: g.date,
        winner: won ? src.self : src.opp,
        loser: won ? src.opp : src.self,
        winnerPoints: won ? g.pf : g.pa,
        loserPoints: won ? g.pa : g.pf,
        margin: Math.abs(g.pf - g.pa),
        winnerSite: won ? g.site : flipSite(g.site),
      };
    })
    .sort((x, y) => cmpStr(x.date, y.date) || x.week - y.week);
}

/**
 * Head-to-head flags for a set of teams (e.g. a trio): every meeting between any two of them,
 * chronological. When all three played each other this returns (at least) three games.
 */
export function trioHeadToHead(week: WeekFile, slugs: readonly string[]): H2HGame[] {
  const out: H2HGame[] = [];
  for (let i = 0; i < slugs.length; i++) {
    for (let j = i + 1; j < slugs.length; j++) out.push(...headToHead(week, slugs[i]!, slugs[j]!));
  }
  return out.sort((x, y) => cmpStr(x.date, y.date) || x.week - y.week || cmpStr(x.winner, y.winner));
}

/** Committee rank minus GWD rank for every pool team, in prior order. */
export function deltas(week: WeekFile): DeltaRow[] {
  return pool(week).map((s) => {
    const t = team(week, s);
    const c = t.ranks.committee;
    return { slug: s, committee: c, gwd: t.ranks.sor, delta: c === null ? null : c - t.ranks.sor };
  });
}

/** Bubble rows: committee ranks `from`..`to` (default 8-20) sorted by GWD rank. Empty without a committee. */
export function bubble(week: WeekFile, opts: { from?: number; to?: number } = {}): DeltaRow[] {
  const committee = committeeOrder(week);
  if (!committee) return [];
  const from = opts.from ?? 8;
  const to = opts.to ?? 20;
  const rows: DeltaRow[] = [];
  committee.forEach((s, i) => {
    const rank = i + 1;
    if (rank < from || rank > to) return;
    const g = team(week, s).ranks.sor;
    rows.push({ slug: s, committee: rank, gwd: g, delta: rank - g });
  });
  return rows.sort((x, y) => x.gwd - y.gwd || (x.committee ?? 0) - (y.committee ?? 0));
}

/** Every pair in the committee top 25 (C(25,2) = 300), better rank first; empty without a committee. */
export function comparePairs(week: WeekFile): ComparePair[] {
  const c = committeeOrder(week);
  if (!c) return [];
  const out: ComparePair[] = [];
  for (let i = 0; i < c.length; i++) {
    for (let j = i + 1; j < c.length; j++) out.push(pairOf(c[i]!, i + 1, c[j]!, j + 1));
  }
  return out;
}

function pairOf(a: string, aRank: number, b: string, bRank: number): ComparePair {
  return aRank <= bRank ? { a, b, aRank, bRank, slug: `${a}-vs-${b}` } : { a: b, b: a, aRank: bRank, bRank: aRank, slug: `${b}-vs-${a}` };
}

/**
 * The `n` compare pages nearest to a committee-ranked team (by committee-rank distance; at equal
 * distance the better-ranked neighbor first). Empty for unranked teams or without a committee.
 */
export function nearestCompares(week: WeekFile, slug: string, n = 3): ComparePair[] {
  const c = committeeOrder(week);
  if (!c) return [];
  const idx = c.indexOf(slug);
  if (idx < 0) return [];
  const others = c
    .map((s, i) => ({ s, i }))
    .filter((o) => o.i !== idx)
    .sort((x, y) => Math.abs(x.i - idx) - Math.abs(y.i - idx) || x.i - y.i);
  return others.slice(0, n).map((o) => pairOf(slug, idx + 1, o.s, o.i + 1));
}

/** Conference tables for every conference in the file, sorted by conference name. */
export function conferenceStandings(week: WeekFile): ConferenceStanding[] {
  const byConf = new Map<string, Team[]>();
  for (const t of Object.values(week.teams)) {
    const list = byConf.get(t.conference) ?? [];
    list.push(t);
    byConf.set(t.conference, list);
  }
  const non = new Set(week.playoff.nonConferences);
  return [...byConf.keys()].sort(cmpStr).map((conference) => {
    const rows: StandingRow[] = byConf.get(conference)!.map((t) => ({
      slug: t.slug,
      confRecord: { ...t.confRecord },
      record: { ...t.record },
      confPct: winPct(t.confRecord.w, t.confRecord.l),
      gwd: t.ranks.sor,
    }));
    rows.sort(
      (a, b) =>
        b.confPct - a.confPct ||
        b.confRecord.w - a.confRecord.w ||
        winPct(b.record.w, b.record.l) - winPct(a.record.w, a.record.l) ||
        a.gwd - b.gwd ||
        cmpStr(a.slug, b.slug),
    );
    const crowns = !non.has(conference);
    const best = rows.length ? rows[0]!.confPct : 0;
    return {
      conference,
      crownsChampion: crowns,
      champion: crowns ? week.champions?.[conference] ?? null : null,
      leaders: crowns ? rows.filter((r) => r.confPct === best).map((r) => r.slug) : [],
      teams: rows,
    };
  });
}

/** Convenience: prior positions for the pool (1-based). */
export function priorPositions(week: WeekFile): Map<string, number> {
  const m = new Map<string, number>();
  prior(week).forEach((s, i) => m.set(s, i + 1));
  return m;
}

/** Convenience: GWD rank (`ranks.sor`) for every FBS team. */
export function gwdRanks(week: WeekFile): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of gwdOrder(week)) out[s] = week.teams[s]!.ranks.sor;
  return out;
}
