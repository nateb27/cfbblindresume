/**
 * Build-time helpers for the content pages: data access (cached per build), URLs, number and date
 * formatting, and the playoff/committee wording every page shares. Node only (imports data-node).
 * Everything is derived from the week files; nothing here names a team, count or format.
 */
import { listSeasons, loadSeasonIndex, loadWeek } from '@lib/data-node';
import { committeeOrder, gwdOrder } from '@lib/data';
import { computePlayoffs, orderedFormats, playoffContext, type PlayoffResult, type PlayoffResults, type Seed } from '@lib/playoff';
import { rankFill, tierFor } from '@lib/tiers';
import type { PlayoffFormat, Team, WeekFile } from '@lib/types';
import { tierKey, type TierKey } from '../styles/tokens';

/* ------------------------------------------------------------------ site constants */

export const SITE = {
  name: 'CFB Blind Resume',
  wordmark: ['CFB', 'Blind Resume'] as const,
  origin: 'https://cfbblindresume.com',
  email: 'hello@cfbblindresume.com',
  tagline: 'Same game. Different numbers.',
} as const;

/** Absolute canonical URL for a site path, never with a trailing slash ("/" -> origin). */
export function absUrl(path: string): string {
  const p = path === '/' ? '' : path.replace(/\/+$/, '');
  return `${SITE.origin}${p}`;
}

export const teamHref = (slug: string): string => `/teams/${slug}`;
export const compareHref = (pairSlug: string): string => `/compare/${pairSlug}`;
export const archiveHref = (season: number, week: number): string => `/rankings/${season}/week-${week}`;
export const teamOgPath = (slug: string): string => `/og/teams/${slug}.png`;
export const compareOgPath = (pairSlug: string): string => `/og/compare/${pairSlug}.png`;
export const DEFAULT_OG = '/og/default.png';

/** Main navigation keys (SiteHeader). */
export type NavKey = 'play' | 'rankings' | 'bubble' | 'teams' | 'how';

/** Ads are on only when PUBLIC_ADS=on at build time (default off). */
export const ADS_ON = import.meta.env.PUBLIC_ADS === 'on';

/* ------------------------------------------------------------------ data (cached per build) */

export interface WeekRef {
  season: number;
  week: number;
  asOf: string;
  label: string;
  hasCommittee: boolean;
}

let refsCache: WeekRef[] | null = null;
/** Every week file across every season, oldest first. */
export function allWeekRefs(): WeekRef[] {
  if (!refsCache) {
    refsCache = listSeasons().flatMap((season) => loadSeasonIndex(season).weeks.map((w) => ({ season, ...w })));
  }
  return refsCache;
}

const weekCache = new Map<string, WeekFile>();
/** A week file (cached). */
export function getWeek(season: number, week: number): WeekFile {
  const k = `${season}-${week}`;
  let w = weekCache.get(k);
  if (!w) {
    w = loadWeek(season, week);
    weekCache.set(k, w);
  }
  return w;
}

/** The newest week of the newest season: what every current page is built from. */
export function latestWeek(): WeekFile {
  const refs = allWeekRefs();
  const last = refs[refs.length - 1];
  if (!last) throw new Error('no week files in /data');
  return getWeek(last.season, last.week);
}

/** All week files of one season, oldest first. */
export function seasonWeeks(season: number): WeekFile[] {
  return allWeekRefs()
    .filter((r) => r.season === season)
    .map((r) => getWeek(r.season, r.week));
}

/* ------------------------------------------------------------------ playoff views (cached per week) */

export interface PlayoffViews {
  /** Formats, default first. */
  formats: PlayoffFormat[];
  /** Results by the committee order (null before the first release). */
  committee: PlayoffResults | null;
  /** Results by FEI GWD order (every FBS team). */
  fei: PlayoffResults;
}

const viewCache = new WeakMap<WeekFile, PlayoffViews>();
export function playoffViews(week: WeekFile): PlayoffViews {
  let v = viewCache.get(week);
  if (!v) {
    const ctx = playoffContext(week);
    const c = committeeOrder(week);
    v = {
      formats: orderedFormats(week.playoffFormats),
      committee: c ? computePlayoffs(c, ctx) : null,
      fei: computePlayoffs(gwdOrder(week), ctx),
    };
    viewCache.set(week, v);
  }
  return v;
}

/** "12-team" style heading word for a format (from its size). */
export const formatSizeLabel = (f: PlayoffFormat): string => `${f.size}-team`;

/** Status line: "2026 format" for the current one, "Proposed for 2027 — not final" otherwise. */
export function formatStatus(f: PlayoffFormat, season: number): string {
  return f.status === 'proposed' ? `Proposed for ${season + 1} — not final` : `${season} format`;
}

/** Segment-style label: "12 teams · 2026 format" / "24 teams · proposed". */
export function formatShortLabel(f: PlayoffFormat, season: number): string {
  return f.status === 'proposed' ? `${f.label} · proposed` : `${f.label} · ${season} format`;
}

/** Where one team stands in one projected field. */
export interface FieldStanding {
  kind: 'in' | 'first-out' | 'out';
  seed?: Seed;
  /** 1-based position in the first five out. */
  outPos?: number;
  bye?: boolean;
}

export function standingIn(p: PlayoffResult, slug: string): FieldStanding {
  const seed = p.field.find((s) => s.slug === slug);
  if (seed) return { kind: 'in', seed, bye: p.byes.some((b) => b.slug === slug) };
  const i = p.firstFiveOut.indexOf(slug);
  if (i >= 0) return { kind: 'first-out', outPos: i + 1 };
  return { kind: 'out' };
}

/** "ACC leader" / "ACC champion" for champion bids, "guaranteed spot", "at-large". */
export function bidLabel(s: Seed, p: PlayoffResult): string {
  if (s.bid === 'champion') {
    const ch = p.champions.find((c) => c.slug === s.slug);
    return `${s.conference ?? ch?.conference ?? 'Conference'} ${ch?.standIn ? 'leader' : 'champion'}`;
  }
  if (s.bid === 'guaranteed') return 'guaranteed spot';
  return 'at-large';
}

/** Short bid tag for tables: "Auto bid", "Guaranteed", "At-large". */
export function bidTag(s: Seed): string {
  return s.bid === 'champion' ? 'Auto bid' : s.bid === 'guaranteed' ? 'Guaranteed' : 'At-large';
}

/**
 * Cut position for an order shown as a ranked list: the largest k such that ranks 1..k are all in
 * the field. Every field team below it entered on an automatic bid.
 */
export function contiguousCut(order: readonly string[], p: PlayoffResult): number {
  const inField = new Set(p.field.map((s) => s.slug));
  let k = 0;
  while (k < order.length && inField.has(order[k]!)) k++;
  return k;
}

/* ------------------------------------------------------------------ formatting */

const MINUS = '−';

/** "+13" / "−3" / "0". */
export function signed(n: number): string {
  return n > 0 ? `+${n}` : n < 0 ? `${MINUS}${Math.abs(n)}` : '0';
}

/** FEI-style value: 1.97, .35, −.55. */
export function feiValue(v: number): string {
  const s = Math.abs(v).toFixed(2).replace(/^0(?=\.)/, '');
  return v < 0 ? `${MINUS}${s}` : s;
}

export const record = (t: Pick<Team, 'record'>): string => `${t.record.w}-${t.record.l}`;
export const confRecord = (t: Pick<Team, 'confRecord'>): string => `${t.confRecord.w}-${t.confRecord.l}`;

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
/** "two spots" / "one spot" / "12 spots". */
export function spots(n: number): string {
  const a = Math.abs(n);
  return `${a < 10 ? WORDS[a] : a} ${a === 1 ? 'spot' : 'spots'}`;
}

/** 1st, 2nd, 3rd, 11th, 22nd. */
export function ordinal(n: number): string {
  const m = n % 100;
  if (m >= 11 && m <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

const dateFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const shortDateFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const longDateFmt = new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const toDate = (iso: string): Date => new Date(`${iso}T00:00:00Z`);
/** "Nov 5, 2026". */
export const fmtDate = (iso: string): string => dateFmt.format(toDate(iso));
/** "Sep 4". */
export const fmtShortDate = (iso: string): string => shortDateFmt.format(toDate(iso));
/** "November 3, 2026". */
export const fmtLongDate = (iso: string): string => longDateFmt.format(toDate(iso));

/** Game site words for tables. */
export const SITE_LABELS = { home: 'Home', away: 'Away', neutral: 'Neutral' } as const;

/* ------------------------------------------------------------------ ratings display */

/** data-tier key for a rank bar (the tier of that rank band). */
export function bandKey(rank: number): TierKey {
  return tierKey(tierFor({ fbs: true, feiRank: rank }).stars);
}

/** --fill value for a rank bar. */
export function fill(rank: number, fbsCount: number): string {
  return rankFill(rank, fbsCount).toFixed(3);
}

/** Metric definitions shared by the stat row, cards and how-it-works. */
export const METRICS = {
  sor: { label: 'Strength of record', short: 'Str. of record', source: 'GWD', anchor: 'strength-of-record' },
  off: { label: 'Offense', short: 'Offense', source: 'OFEI', anchor: 'offense' },
  def: { label: 'Defense', short: 'Defense', source: 'DFEI', anchor: 'defense' },
  sos: { label: 'Schedule', short: 'Schedule', source: 'ELS', anchor: 'schedule' },
  fei: { label: 'FEI overall', short: 'FEI overall', source: 'FEI', anchor: 'fei' },
} as const;

/* ------------------------------------------------------------------ committee vs FEI wording */

/**
 * Plain-words comparison of the committee rank and FEI's strength of record (GWD) rank.
 * Returns parts so pages can bold the numbers: [{ text } | { rank }].
 */
export type Phrase = ({ text: string } | { rank: string })[];

export function committeeVsFei(t: Team, week: WeekFile): Phrase {
  const g = t.ranks.sor;
  const c = t.ranks.committee;
  const n = week.fbsCount;
  if (!week.committee) {
    return [{ text: `The committee has not released its first ranking yet. FEI's strength of record has ${t.name} ` }, { rank: `#${g}` }, { text: ` of ${n}.` }];
  }
  if (c === null) {
    if (g <= week.committee.length) {
      return [
        { text: `The committee leaves ${t.name} out of its top ${week.committee.length}. FEI's strength of record has them ` },
        { rank: `#${g}` },
        { text: `, inside its own top ${week.committee.length}.` },
      ];
    }
    return [{ text: `${t.name} is outside the committee's top ${week.committee.length}, and FEI's strength of record has them ` }, { rank: `#${g}` }, { text: ` of ${n}.` }];
  }
  if (c === g) {
    return [{ text: `The committee and FEI's strength of record agree: ${t.name} is ` }, { rank: `#${c}` }, { text: '.' }];
  }
  const d = c - g;
  return [
    { text: `The committee has ${t.name} ` },
    { rank: `#${c}` },
    { text: `. FEI's strength of record puts them ` },
    { rank: `#${g}` },
    { text: `, ${spots(d)} ${d > 0 ? 'higher' : 'lower'}.` },
  ];
}

/** Sentence fragment for a delta from FEI's side: "FEI 5 higher" etc. (sr-only text for .delta). */
export function deltaSr(delta: number): string {
  return delta > 0 ? ` FEI ranks them ${spots(delta)} higher than the committee` : ` FEI ranks them ${spots(delta)} lower than the committee`;
}

/* ------------------------------------------------------------------ JSON-LD helpers */

export function sportsTeamLd(t: Team, opts: { withContext?: boolean } = {}): Record<string, unknown> {
  return {
    ...(opts.withContext ? { '@context': 'https://schema.org' } : {}),
    '@type': 'SportsTeam',
    name: t.name,
    ...(t.mascot ? { alternateName: `${t.name} ${t.mascot}` } : {}),
    sport: 'American football',
    url: absUrl(teamHref(t.slug)),
    memberOf: { '@type': 'SportsOrganization', name: t.conference },
  };
}

export function breadcrumbLd(items: { name: string; path: string }[]): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, item: absUrl(it.path) })),
  };
}

export function itemListLd(name: string, items: { name: string; path: string }[], extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name,
    numberOfItems: items.length,
    itemListOrder: 'https://schema.org/ItemListOrderAscending',
    itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, url: absUrl(it.path) })),
    ...extra,
  };
}

/** Anchor id for a conference on /teams ("Big Ten" -> "big-ten"). */
export function confAnchor(conference: string): string {
  return conference
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** A seed's opening game: a bye, or a first-round game at home (better seed) or away. */
export type Opening = { kind: 'bye' } | { kind: 'home' | 'away'; opp: Seed };

export function openingGame(p: PlayoffResult, slug: string): Opening | null {
  if (p.byes.some((b) => b.slug === slug)) return { kind: 'bye' };
  for (const g of p.games) {
    if (g.round !== 1) continue;
    const [a, b] = g.sides;
    if (a.kind !== 'team' || b.kind !== 'team') continue;
    if (a.team.slug === slug) return { kind: 'home', opp: b.team };
    if (b.team.slug === slug) return { kind: 'away', opp: a.team };
  }
  return null;
}
