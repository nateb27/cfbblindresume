/**
 * Weekly snapshot schema. One file per week at data/{season}/week-{N}.json, written by
 * /pipeline and committed. This file is the single source of truth for every page and the
 * game. Application code must never hard-code team names, ranks, counts or special cases;
 * everything (including the playoff format) comes from here.
 *
 * Conventions
 * - Team keys are stable slugs (lowercase ascii, hyphenated): "ohio-state", "miami", "miami-oh",
 *   "texas-am", "hawaii", "san-jose-state". Slugs are pinned per CFBD team id in
 *   pipeline/slugs.json so they never change between weeks.
 * - All ranks are 1-based integers among FBS teams (1 = best). For `sos`, 1 = hardest schedule.
 * - `week` is the last regular-season week whose games are included ("After Week 9").
 */

export const SCHEMA_VERSION = 1 as const;

export type Site = 'home' | 'away' | 'neutral';
export type Result = 'W' | 'L';

export interface WeekFile {
  schemaVersion: typeof SCHEMA_VERSION;
  season: number;
  /** Last completed week of games included. */
  week: number;
  /** Date the data was pulled, YYYY-MM-DD. Used for sitemap lastmod. */
  asOf: string;
  /** Human label, e.g. "After Week 9". */
  label: string;
  sources: Sources;
  playoff: PlayoffFormat;
  /** Number of FBS teams this season (138 in 2026). Bars and validation use this, never a constant. */
  fbsCount: number;
  /** FBS teams keyed by slug. */
  teams: Record<string, Team>;
  /** Non-FBS opponents (FCS, Division II, ...) keyed by slug. Referenced by Game.opp when oppFbs is false. */
  opponents: Record<string, Opponent>;
  /**
   * Committee top 25 as slugs in rank order (index 0 = #1), or null before the first release
   * of the season. When null: hide every committee column, use FEI GWD order as the prior.
   */
  committee: string[] | null;
  /**
   * Actual conference champions once championship games are played, keyed by conference name.
   * Absent or partial before then; missing conferences use the stand-in leader rule.
   */
  champions?: Record<string, string>;
}

export interface Sources {
  ratings: { name: 'FEI'; author: 'Brian Fremeau'; url: string; throughWeek: number | null };
  games: { name: 'CollegeFootballData.com'; url: string };
  committee: { name: 'College Football Playoff Selection Committee'; url: string; releaseDate: string } | null;
}

export interface PlayoffFormat {
  /** Field size, e.g. 12. */
  size: number;
  /** Number of top seeds with first-round byes, e.g. 4. */
  byes: number;
  /** Seeding rule. 'straight' = seeds 1..size in ranking order of the selected field. */
  seeding: 'straight';
  autoBids: {
    /** Number of highest-ranked conference champions that receive automatic bids, e.g. 5. */
    conferenceChampions: number;
    /** Teams guaranteed a spot if ranked at or above a position (2026: Notre Dame if top 12). */
    guaranteed: { slug: string; ifRankedAtOrAbove: number }[];
  };
  /** Conference names that do not crown a champion (e.g. "FBS Independents"). */
  nonConferences: string[];
  /** Where the format rule comes from (URL), shown on how-it-works. */
  sourceUrl: string;
}

export interface Team {
  slug: string;
  /** CFBD team id; stable across seasons. */
  id: number;
  name: string;
  /** Abbreviation, e.g. "UK". */
  short: string;
  mascot: string | null;
  conference: string;
  colors: { primary: string; secondary: string };
  record: { w: number; l: number };
  confRecord: { w: number; l: number };
  ranks: {
    /** Strength of record: FEI GWD rank. */
    sor: number;
    /** Strength of schedule: FEI ELS rank (1 = hardest). */
    sos: number;
    /** OFEI rank. */
    off: number;
    /** DFEI rank. */
    def: number;
    /** Overall FEI rank; used to tier this team when it is someone's opponent. */
    fei: number;
    /** Committee rank 1-25, or null if unranked / no release yet. */
    committee: number | null;
  };
  /** Raw FEI values, for display on content pages. */
  values: { fei: number; ofei: number; dfei: number; gwd: number; els: number };
  /** Completed games in chronological order. */
  games: Game[];
}

export interface Game {
  week: number;
  /** YYYY-MM-DD (local kickoff date in US Eastern). */
  date: string;
  /** Slug of the opponent; key into `teams` when oppFbs, else into `opponents`. */
  opp: string;
  oppFbs: boolean;
  site: Site;
  pf: number;
  pa: number;
  result: Result;
  conf: boolean;
}

export interface Opponent {
  slug: string;
  name: string;
  /** CFBD classification: 'fcs', 'ii', 'iii', ... */
  classification: string;
}

/** data/{season}/index.json: every week file that exists, newest last. */
export interface SeasonIndex {
  season: number;
  weeks: { week: number; asOf: string; label: string; hasCommittee: boolean }[];
}
