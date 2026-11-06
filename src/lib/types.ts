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
 *
 * Schema history
 * - 1: a single `playoff: PlayoffFormat`.
 * - 2: `playoffFormats: PlayoffFormat[]` (exactly one `default`), so the site can show the current
 *   12-team format and the proposed 24-team format side by side. PlayoffFormat gained id, label,
 *   status, default, note, sourceName, checkedOn and powerConferences; `autoBids.conferenceChampions`
 *   became `autoBids.rules`. Every other field kept its meaning.
 *   Additive (still 2): optional `Team.upcoming` (games not yet played, after week N). Files
 *   without it stay valid; readers treat a missing list as unknown, not as "no games left".
 */

export const SCHEMA_VERSION = 2 as const;

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
  /**
   * Every playoff format the site can show, from pipeline/playoff_formats.json (the one place they
   * live). Exactly one has `default: true`; ids are unique. Order is the config's order; use
   * `orderedFormats()` from playoff.ts for default-first.
   */
  playoffFormats: PlayoffFormat[];
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

/** Which conference champions an auto-bid rule draws from (see PlayoffFormat.powerConferences). */
export type AutoBidPool = 'all' | 'power' | 'nonPower';

/**
 * One automatic-bid rule: the `count` highest-ranked conference champions from `from` that do not
 * already hold a champion bid. Rules apply in listed order.
 * - 'all': any conference champion.
 * - 'power': champions of conferences in `powerConferences`.
 * - 'nonPower': champions of every other conference that crowns one (not in `nonConferences`).
 */
export interface AutoBidRule {
  from: AutoBidPool;
  /** Positive int, e.g. 5 for the 2026 format's "five highest-ranked conference champions". */
  count: number;
}

/**
 * A playoff format: how a field is chosen, seeded and bracketed from an ordered list of teams.
 * Pure data; src/lib/playoff.ts applies it. Nothing about any format is hard-coded in app code.
 */
export interface PlayoffFormat {
  /**
   * Stable id: lowercase ascii letters, digits and hyphens with at least one letter (never purely
   * numeric, so object keys keep insertion order), e.g. "12-team" or "24-team". Keys results.
   */
  id: string;
  /** Short UI label, e.g. "12 teams". */
  label: string;
  /** 'current' = the format in force this season; 'proposed' = reported/proposed, not final. */
  status: 'current' | 'proposed';
  /** Exactly one format per week file is the default (shown first, selected initially). */
  default: boolean;
  /** One plain-English sentence stating the rules, shown under the format toggle and on how-it-works. */
  note: string;
  /** Who states the rule, e.g. "College Football Playoff" or "Deseret News". */
  sourceName: string;
  /** Where the rule comes from (https URL), linked next to `note`. */
  sourceUrl: string;
  /** Date the source was last checked, YYYY-MM-DD. */
  checkedOn: string;
  /** Field size, e.g. 12. */
  size: number;
  /**
   * Number of top seeds with first-round byes. Brackets are the standard seeded bracket for the next
   * power of two, so this always equals nextPow2(size) - size (validated): 12 -> 4, 24 -> 8.
   */
  byes: number;
  /** Seeding rule. 'straight' = seeds 1..size in ranking order of the selected field. */
  seeding: 'straight';
  autoBids: {
    /** Champion auto-bid rules, applied in order (2026: [{ from: 'all', count: 5 }]). */
    rules: AutoBidRule[];
    /** Teams guaranteed a spot if ranked at or above a position (2026: Notre Dame if top 12). */
    guaranteed: { slug: string; ifRankedAtOrAbove: number }[];
  };
  /** Conference names whose champions count as 'power' (e.g. ACC, Big 12, Big Ten, SEC). */
  powerConferences: string[];
  /** Conference names that do not crown a champion (e.g. "FBS Independents"). */
  nonConferences: string[];
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
  /**
   * Additive: scheduled regular-season games after week N that were not yet played when the file
   * was built, in chronological order (conference championship games appear once CFBD lists them).
   * Optional: absent in files built before it existed.
   */
  upcoming?: UpcomingGame[];
}

/** A scheduled game (no score yet), from the team's point of view. */
export interface UpcomingGame {
  week: number;
  /** YYYY-MM-DD (kickoff date in US Eastern; the time may still be TBD). */
  date: string;
  /** Slug of the opponent; key into `teams` when oppFbs, else into `opponents`. */
  opp: string;
  oppFbs: boolean;
  site: Site;
  conf: boolean;
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
