/**
 * Build-time helpers for the content pages: data access (cached per build), URLs, number and date
 * formatting, and the playoff/committee wording every page shares. Node only (imports data-node).
 * Everything is derived from the week files; nothing here names a team, count or format.
 */
import { listSeasons, loadSeasonIndex, loadWeek } from '@lib/data-node';
import { committeeOrder, gameRows, gwdOrder, upcomingRows, type GameRow, type UpcomingRow } from '@lib/data';
import { computePlayoff, computePlayoffs, orderedFormats, playoffContext, type PlayoffResult, type PlayoffResults, type Seed } from '@lib/playoff';
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
export const compareHubHref = '/compare';
export const teamOgPath = (slug: string): string => `/og/teams/${slug}.png`;
export const compareOgPath = (pairSlug: string): string => `/og/compare/${pairSlug}.png`;
export const DEFAULT_OG = '/og/default.png';
/**
 * Cache-busting suffix for share images: the images bake in one week's numbers, and social
 * networks cache og:image per URL, so the URL changes with every snapshot ("?v=2026-9").
 */
export const ogVersion = (w: Pick<WeekFile, 'season' | 'week'>): string => `v=${w.season}-${w.week}`;

/** Hand-edited date of the last change to /privacy (not the season: it must not move by itself). */
export const PRIVACY_UPDATED = '2026-11-06';

/** Main navigation keys (SiteHeader). */
export type NavKey = 'play' | 'rankings' | 'bubble' | 'teams' | 'how';

/** Ads are on only when PUBLIC_ADS=on at build time (default off). */
export const ADS_ON = import.meta.env.PUBLIC_ADS === 'on';
/** The ad network named by PUBLIC_AD_NETWORK (the loader runs only when it is set). */
export const AD_NETWORK = (import.meta.env.PUBLIC_AD_NETWORK as string | undefined) || undefined;

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

/** Kicker that says "proposed" once: "12 teams · 2026 format" / "24 teams · Proposed for 2027 — not final". */
export function formatKicker(f: PlayoffFormat, season: number): string {
  return `${f.label} · ${formatStatus(f, season)}`;
}

/** "the 12-team field" / "the proposed 24-team field". */
export function formatFieldWords(f: PlayoffFormat): string {
  return f.status === 'proposed' ? `the proposed ${f.size}-team field` : `the ${f.size}-team field`;
}

/** "12-team and proposed 24-team" (for descriptions). */
export function formatsPhrase(formats: readonly PlayoffFormat[]): string {
  return joinAnd(formats.map((f) => (f.status === 'proposed' ? `proposed ${f.size}-team` : `${f.size}-team`)));
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

/** One wording for "Nth team out of the field" everywhere: "1st out", "2nd out". */
export const outText = (pos: number): string => `${ordinal(pos)} out`;

const guaranteeCache = new WeakMap<PlayoffResult, Set<string>>();
/**
 * Teams whose guaranteed bid actually changes the field: without the guarantee they would be
 * out. A guaranteed team that would make it as an at-large anyway is shown as "at-large", so
 * nobody reads the guarantee as the reason another team is out.
 */
export function guaranteeDecides(p: PlayoffResult, week: WeekFile): Set<string> {
  let set = guaranteeCache.get(p);
  if (!set) {
    set = new Set();
    const guaranteed = p.field.filter((s) => s.bid === 'guaranteed');
    if (guaranteed.length) {
      const without = computePlayoff(p.order, playoffContext(week), { ...p.format, autoBids: { ...p.format.autoBids, guaranteed: [] } });
      const inWithout = new Set(without.field.map((s) => s.slug));
      for (const g of guaranteed) if (!inWithout.has(g.slug)) set.add(g.slug);
    }
    guaranteeCache.set(p, set);
  }
  return set;
}

/** "ACC leader" / "ACC champion" for champion bids, "guaranteed spot" (only when it decides), "at-large". */
export function bidLabel(s: Seed, p: PlayoffResult, week: WeekFile): string {
  if (s.bid === 'champion') {
    const ch = p.champions.find((c) => c.slug === s.slug);
    return `${s.conference ?? ch?.conference ?? 'Conference'} ${ch?.standIn ? 'leader' : 'champion'}`;
  }
  if (s.bid === 'guaranteed' && guaranteeDecides(p, week).has(s.slug)) return 'guaranteed spot';
  return 'at-large';
}

/**
 * Why a field's cut line falls where it does: teams ranked inside the field size that are out
 * (`out`), and the automatic bids from below the field size that took their places (`by`).
 */
export function cutStory(p: PlayoffResult): { out: string[]; by: Seed[] } {
  const inField = new Set(p.field.map((s) => s.slug));
  const out = p.order.slice(0, p.format.size).filter((s) => !inField.has(s));
  return { out, by: out.length ? p.field.filter((s) => s.bid !== 'at-large' && s.rank > p.format.size) : [] };
}

/** "CFP #25" / "unranked by the committee" / "SoR #31": a team's rank in one ordering, in words. */
export function rankIn(key: 'committee' | 'fei', t: Team): string {
  if (key === 'fei') return `SoR #${t.ranks.sor}`;
  return t.ranks.committee === null ? 'unranked by the committee' : `CFP #${t.ranks.committee}`;
}

/** "takes an automatic bid as Pac-12 leader" / "take automatic bids" (for displacedBy / cutStory). */
export function autoBidPhrase(by: readonly Seed[], p: PlayoffResult, week: WeekFile): string {
  if (by.length === 1) {
    const label = bidLabel(by[0]!, p, week);
    return `takes an automatic bid as ${label === 'guaranteed spot' ? 'a guaranteed team' : label}`;
  }
  return 'take automatic bids';
}

/**
 * Automatic bids that pushed a team out: field teams below it in the order that got in on an
 * automatic bid. Empty when the team was not displaced (it is simply ranked below the field).
 */
export function displacedBy(p: PlayoffResult, slug: string): Seed[] {
  const pos = p.order.indexOf(slug);
  if (pos < 0 || pos >= p.format.size) return [];
  return p.field.filter((s) => s.bid !== 'at-large' && s.rank > pos + 1);
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

/** "A", "A and B", "A, B and C". */
export function joinAnd(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** First letter lowercase ("By FEI's strength of record" -> "by FEI's strength of record"). */
export const lowerFirst = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1);

/**
 * Meta description from parts: the first part always, then each optional part while the total
 * stays within `max` characters (search results cut around 155-160). A part given as an array is a
 * list of alternatives, longest first: the first one that still fits is used (for the head, the last
 * one if none fits). Unique facts first.
 */
export function clampText(parts: readonly (string | readonly string[])[], max = 155): string {
  const [head, ...rest] = parts;
  // The head is always used: its first alternative that fits, else its shortest.
  let out = typeof head === 'string' ? head : (head?.find((a) => a.length <= max) ?? head?.[head.length - 1] ?? '');
  for (const p of rest) {
    const alts = typeof p === 'string' ? [p] : p;
    const fit = alts.find((a) => (out + a).length <= max);
    if (fit) out += fit;
  }
  return out;
}

/** First candidate that fits in `max` characters (titles: search results cut around 60). */
export function firstFit(candidates: readonly string[], max = 62): string {
  return candidates.find((c) => c.length <= max) ?? candidates[candidates.length - 1]!;
}

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

/** "at Rutgers" / "vs Oregon" / "vs Georgia (neutral)": the way a schedule reads. */
export function siteVs(site: 'home' | 'away' | 'neutral', name: string): string {
  return site === 'away' ? `at ${name}` : site === 'neutral' ? `vs ${name} (neutral)` : `vs ${name}`;
}

/* ------------------------------------------------------------------ ratings display */

/** data-tier key for a rank bar (the tier of that rank band). */
export function bandKey(rank: number): TierKey {
  return tierKey(tierFor({ fbs: true, feiRank: rank }).stars);
}

/** --fill value for a rank bar. */
export function fill(rank: number, fbsCount: number): string {
  return rankFill(rank, fbsCount).toFixed(3);
}

/**
 * Short label for FEI's strength of record (GWD) rank wherever space is tight. Bare "FEI" always
 * means FEI overall (ranks.fei); the strength-of-record rank is never labeled just "FEI".
 */
export const SOR = 'SoR';
export const SOR_LONG = 'FEI strength of record';

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

/**
 * Screen-reader sentence for a .delta: `delta` > 0 means `subject` ranks the team higher than
 * `ref` does. Default: FEI's strength of record compared with the committee.
 */
export function deltaSr(delta: number, subject = "FEI's strength of record", ref = 'the committee'): string {
  if (delta === 0) return ` ${subject} and ${ref} agree`;
  return ` ${subject} ranks them ${spots(delta)} ${delta > 0 ? 'higher' : 'lower'} than ${ref}`;
}

/* ------------------------------------------------------------------ resume highlights */

export interface ResumeHighlights {
  /** Record against teams in the committee's top 25 (null before the first release). */
  vsCommittee: { w: number; l: number; n: number } | null;
  /** The win over the best opponent (by current FEI overall rank, then date). */
  bestWin: GameRow | null;
  /** The loss to the weakest opponent. */
  worstLoss: GameRow | null;
}

/** The resume the way fans say it: record vs ranked teams, best win, worst loss. */
export function resumeHighlights(week: WeekFile, slug: string): ResumeHighlights {
  const rows = gameRows(week, slug); // toughest first
  const ranked = rows.filter((g) => g.opp.fbs && week.teams[g.opp.slug]?.ranks.committee != null);
  return {
    vsCommittee: week.committee
      ? { w: ranked.filter((g) => g.result === 'W').length, l: ranked.filter((g) => g.result === 'L').length, n: week.committee.length }
      : null,
    bestWin: rows.find((g) => g.result === 'W') ?? null,
    worstLoss: [...rows].reverse().find((g) => g.result === 'L') ?? null,
  };
}

/** Remaining-schedule summary for "Still to play" (null when the week file has no schedules). */
export interface UpcomingSummary {
  rows: UpcomingRow[];
  /** Games left against teams in the committee's top 25 (null before the first release). */
  vsCommittee: number | null;
  /** The toughest game left: best opponent tier, then better FEI rank, then date. */
  toughest: UpcomingRow | null;
}

export function upcomingSummary(week: WeekFile, slug: string): UpcomingSummary | null {
  const rows = upcomingRows(week, slug);
  if (!rows) return null;
  const toughest = [...rows].sort((x, y) => x.tier.order - y.tier.order || (x.opp.feiRank ?? 999) - (y.opp.feiRank ?? 999) || (x.date < y.date ? -1 : 1))[0] ?? null;
  return { rows, vsCommittee: week.committee ? rows.filter((r) => r.oppCommittee !== null).length : null, toughest };
}

/** "4 games left · 1 vs the committee's top 25": the short line above a remaining schedule. */
export function upcomingLine(week: WeekFile, u: UpcomingSummary): string {
  const n = u.rows.length;
  const bits = [`${n} ${n === 1 ? 'game' : 'games'} left`];
  if (u.vsCommittee !== null && n > 0) bits.push(`${u.vsCommittee} vs the committee's top ${week.committee?.length ?? 25}`);
  return bits.join(' · ');
}

/** "#4 Indiana" when the committee ranks the opponent, else "Indiana (FEI #31)" / "Idaho (FCS)". */
export function oppWithRank(week: WeekFile, g: GameRow): { name: string; slug: string | null; rank: string } {
  if (!g.opp.fbs) return { name: g.opp.name, slug: null, rank: g.tier.label.replace(/ team$/, '') };
  const t = week.teams[g.opp.slug];
  const c = t?.ranks.committee ?? null;
  return { name: g.opp.name, slug: g.opp.slug, rank: c !== null ? `CFP #${c}` : `FEI #${g.opp.feiRank}` };
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
