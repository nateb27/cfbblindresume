/**
 * The compact payload the game island needs (SPEC "game-data.ts"), emitted at build as
 * /game-data/{season}-{week}.json, plus pure helpers the island, the results page and the
 * Functions use to turn a run into results consistently.
 *
 * The payload carries only FEI ranks, records and game results: no names of metrics we do not use.
 */
import type { PlayoffFormat, Result, Site, WeekFile } from './types';
import { TIERS, type TierKey } from './tiers';
import { fbsSlugsSorted, gameRows, headToHead, qualityWins, resumeStrip, type WL } from './data';
import { gwdOrder, prior as priorOf, TOP_N } from './pool';
import {
  championCandidates,
  computePlayoffs,
  defaultFormat,
  FIRST_OUT_COUNT,
  nonPoolLeaders,
  orderedFormats,
  playoffContext,
  type PlayoffConference,
  type PlayoffContext,
  type PlayoffResult,
  type PlayoffResults,
} from './playoff';
import { rankFromPicks, type RankingResult } from './ranking';
import { agreement, type AgreementRefs, type AgreementSummary, type RankLookup } from './agreement';
import { runViolations, TRIO_RULES, type TrioState } from './trios';

/** Payload format version. 2: `playoffFormats` (all formats, default first) and `gwdOrder` replace `playoff`. */
export const GAME_DATA_VERSION = 2 as const;

/** Length of GameData.feiOrder: a top 25 plus the "first five out" column. */
export const FEI_ORDER_LENGTH = TOP_N + 5;

/**
 * Minimum GWD depth of GameData.teams / gwdOrder (raised to the largest field + five out if a format
 * is bigger). Any order over the payload's teams then extends to a full field + first five out.
 */
export const GWD_DEPTH = 40;

/** Tier legend entry; a card's tier number indexes GameData.tiers. */
export interface GameTier {
  key: TierKey;
  stars: number;
  label: string;
}

/** One game on a blind card: [tier index, site h/a/n, result, margin (absolute points)]. Sorted toughest first. */
export type CardGame = [tier: number, site: 'h' | 'a' | 'n', result: Result, margin: number];

/** One resume-strip dot: [tier index, result]. Chronological. */
export type StripDot = [tier: number, result: Result];

/** Quality record [wins, losses]. */
export type WLPair = [w: number, l: number];

/** The anonymized resume for one pool team. */
export interface BlindCard {
  record: WL;
  /** FEI ranks shown as bars: sor = GWD, off = OFEI, def = DFEI, sos = ELS (1 = hardest). */
  ranks: { sor: number; off: number; def: number; sos: number };
  /** Game log, toughest first. */
  games: CardGame[];
  /** Resume strip, chronological. */
  strip: StripDot[];
  /** Records vs FEI 1-10, 11-25, 26-50. */
  quality: { top10: WLPair; r11to25: WLPair; r26to50: WLPair };
}

/** Identity and ranks for the reveal, results and bracket. */
export interface GameTeam {
  name: string;
  short: string;
  conference: string;
  colors: { primary: string; secondary: string };
  record: WL;
  confRecord: WL;
  /** Committee rank 1-25 or null. */
  committee: number | null;
  /** FEI GWD rank. */
  sor: number;
  /** True for pool teams (they have a card); false for other teams listed for the bracket / FEI grid. */
  inPool: boolean;
}

/** A meeting between two pool teams: [winner slug, margin, week]. */
export type H2HEntry = [winner: string, margin: number, week: number];

/** /game-data/{season}-{week}.json */
export interface GameData {
  v: typeof GAME_DATA_VERSION;
  season: number;
  week: number;
  /** e.g. "After Week 9". */
  label: string;
  asOf: string;
  fbsCount: number;
  /** FEI attribution link (https://bcftoys.com/{season}-fei). */
  ratingsUrl: string;
  hasCommittee: boolean;
  committeeReleaseDate: string | null;
  /** Every FBS slug sorted ascending: the share-code index space. */
  slugs: string[];
  /** Pool in prior order (committee order, then GWD order). */
  prior: string[];
  /** Committee top 25 in order, or null. */
  committee: string[] | null;
  /** FEI GWD order, top 30 (the FEI top 25 plus the next five, for the results grid). */
  feiOrder: string[];
  /**
   * Every team in `teams`, in FEI GWD order (best first; ties: higher GWD value, then slug). Starts
   * with the GWD top {@link GWD_DEPTH}. The playoff extends short orders from it.
   */
  gwdOrder: string[];
  /** Tier legend, index = tier order. */
  tiers: GameTier[];
  /** Pool teams, the GWD top {@link GWD_DEPTH}, and every conference champion candidate. */
  teams: Record<string, GameTeam>;
  /** Pool teams only. */
  cards: Record<string, BlindCard>;
  /** Head-to-head index for pool pairs that met, keyed by {@link h2hKey}. */
  h2h: Record<string, H2HEntry[]>;
  /**
   * Every playoff format, default first (`playoffFormats[0].default === true`). The results screen
   * shows the default and toggles to the others; label, status, note and source are display-ready.
   */
  playoffFormats: PlayoffFormat[];
  /**
   * Conference "standings" as the playoff needs them: per champion-crowning conference, the decided
   * champion or every team tied for the best conference win pct (all have `teams` entries).
   */
  conferences: PlayoffConference[];
  /** Champions that cannot come from the pool (non-pool conference leaders), GWD order. */
  leaders: string[];
}

/** Public path of a week's game data. */
export function gameDataPath(season: number, week: number): string {
  return `/game-data/${season}-${week}.json`;
}

/** Key of a pair in GameData.h2h: the two slugs sorted, joined by "|". */
export function h2hKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

const SITE: Record<Site, 'h' | 'a' | 'n'> = { home: 'h', away: 'a', neutral: 'n' };

/** Build the payload for one week. Deterministic; throws on inconsistent data. */
export function buildGameData(week: WeekFile): GameData {
  const prior = priorOf(week);
  const ctx = playoffContext(week);
  const conferences = ctx.conferences;
  const leaders = nonPoolLeaders(prior, ctx);
  const fullGwd = gwdOrder(week);
  const feiOrder = fullGwd.slice(0, FEI_ORDER_LENGTH);
  const depth = Math.max(GWD_DEPTH, FEI_ORDER_LENGTH, ...ctx.formats.map((f) => f.size + FIRST_OUT_COUNT));
  const inPool = new Set(prior);
  const included = new Set([...fullGwd.slice(0, depth), ...prior, ...championCandidates(ctx)]);
  const gwdSubset = fullGwd.filter((s) => included.has(s));

  const teams: Record<string, GameTeam> = {};
  for (const s of gwdSubset) {
    const t = week.teams[s]!;
    teams[s] = {
      name: t.name,
      short: t.short,
      conference: t.conference,
      colors: { primary: t.colors.primary, secondary: t.colors.secondary },
      record: { ...t.record },
      confRecord: { ...t.confRecord },
      committee: t.ranks.committee,
      sor: t.ranks.sor,
      inPool: inPool.has(s),
    };
  }

  const cards: Record<string, BlindCard> = {};
  for (const s of prior) {
    const t = week.teams[s]!;
    const q = qualityWins(week, s);
    cards[s] = {
      record: { ...t.record },
      ranks: { sor: t.ranks.sor, off: t.ranks.off, def: t.ranks.def, sos: t.ranks.sos },
      games: gameRows(week, s).map((r): CardGame => [r.tier.order, SITE[r.site], r.result, Math.abs(r.margin)]),
      strip: resumeStrip(week, s).map((r): StripDot => [r.tier.order, r.result]),
      quality: { top10: [q.top10.w, q.top10.l], r11to25: [q.r11to25.w, q.r11to25.l], r26to50: [q.r26to50.w, q.r26to50.l] },
    };
  }

  const h2h: Record<string, H2HEntry[]> = {};
  const sortedPool = [...prior].sort();
  for (let i = 0; i < sortedPool.length; i++) {
    for (let j = i + 1; j < sortedPool.length; j++) {
      const games = headToHead(week, sortedPool[i]!, sortedPool[j]!);
      if (games.length) h2h[h2hKey(sortedPool[i]!, sortedPool[j]!)] = games.map((g): H2HEntry => [g.winner, g.margin, g.week]);
    }
  }

  return {
    v: GAME_DATA_VERSION,
    season: week.season,
    week: week.week,
    label: week.label,
    asOf: week.asOf,
    fbsCount: week.fbsCount,
    ratingsUrl: week.sources.ratings.url,
    hasCommittee: week.committee !== null,
    committeeReleaseDate: week.sources.committee?.releaseDate ?? null,
    slugs: fbsSlugsSorted(week),
    prior,
    committee: week.committee ? week.committee.slice() : null,
    feiOrder,
    gwdOrder: gwdSubset,
    tiers: TIERS.map((t) => ({ key: t.key, stars: t.stars, label: t.label })),
    teams,
    cards,
    h2h,
    playoffFormats: ctx.formats,
    conferences,
    leaders,
  };
}

/** A head-to-head flag for the cards ("[H2H] B over A by 16"). */
export interface H2HFlag {
  winner: string;
  loser: string;
  margin: number;
  week: number;
}

/** Every meeting among the given teams (a trio), by week. Several flags when all three played. */
export function headToHeadFlags(gd: GameData, slugs: readonly string[]): H2HFlag[] {
  const out: H2HFlag[] = [];
  for (let i = 0; i < slugs.length; i++) {
    for (let j = i + 1; j < slugs.length; j++) {
      const a = slugs[i]!;
      const b = slugs[j]!;
      for (const [winner, margin, week] of gd.h2h[h2hKey(a, b)] ?? []) {
        out.push({ winner, loser: winner === a ? b : a, margin, week });
      }
    }
  }
  return out.sort((x, y) => x.week - y.week || (x.winner < y.winner ? -1 : x.winner > y.winner ? 1 : 0));
}

/** Playoff context from game data (for computePlayoff / computePlayoffs). */
export function gamePlayoffContext(gd: GameData): PlayoffContext {
  return { formats: orderedFormats(gd.playoffFormats), conferences: gd.conferences, gwdOrder: gd.gwdOrder };
}

/**
 * Playoff results for any order over the payload's teams (your ranking, committee, FEI, fans), for
 * every format, keyed by format id (default first). Short orders are extended in GWD order.
 */
export function gamePlayoffs(gd: GameData, order: readonly string[]): PlayoffResults {
  return computePlayoffs(order, gamePlayoffContext(gd));
}

/** Trio-selection state from game data and the rounds played so far. */
export function gameTrioState(gd: GameData, rounds: readonly (readonly string[])[]): TrioState {
  const gwdRank: Record<string, number> = {};
  for (const s of gd.prior) gwdRank[s] = gd.teams[s]!.sor;
  return { prior: gd.prior, gwdRank, rounds };
}

/** Committee and FEI (GWD) rank lookups for agreement / reveal. Committee is null without a release. */
export function gameAgreementRefs(gd: GameData): AgreementRefs {
  const fei: Record<string, number> = {};
  const committee: Record<string, number | null> = {};
  for (const [s, t] of Object.entries(gd.teams)) {
    fei[s] = t.sor;
    committee[s] = t.committee;
  }
  return { committee: gd.hasCommittee ? (committee as RankLookup) : null, fei };
}

/** Everything the results screen (and the OG image Function) shows for a run. */
export interface RunResults {
  ranking: RankingResult;
  /** The default format's result (the same object as `playoffs[defaultId]`). */
  playoff: PlayoffResult;
  /** Every format's result for the user's ranking, keyed by format id; key order = default first. */
  playoffs: PlayoffResults;
  agreement: AgreementSummary;
  /** True when the run stopped before the standard 15 rounds. */
  partial: boolean;
}

/**
 * Hard-rule problems with a run for this game data (empty = playable/renderable): teams outside
 * the pool, repeated trios, caps, coverage. Use before computeRunResults on decoded share codes.
 */
export function gameRunViolations(gd: GameData, rounds: readonly (readonly string[])[]): string[] {
  return runViolations(rounds, gd.prior);
}

/**
 * Ranking, playoff and agreement for a run. Rounds are [1st, 2nd, 3rd] in the user's order.
 * @throws RangeError if a round names a team outside the pool (check gameRunViolations first).
 */
export function computeRunResults(gd: GameData, rounds: readonly (readonly string[])[]): RunResults {
  const ranking = rankFromPicks(gd.prior, rounds);
  const playoffs = gamePlayoffs(gd, ranking.order);
  return {
    ranking,
    playoff: playoffs[defaultFormat(gd.playoffFormats).id]!,
    playoffs,
    agreement: agreement(rounds, gameAgreementRefs(gd)),
    partial: rounds.length < TRIO_RULES.baseRounds,
  };
}
