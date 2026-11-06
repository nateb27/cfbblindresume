/**
 * Playoff field and bracket from an ordered list (SPEC "Playoff formats"), for any PlayoffFormat in
 * the week file. Formats (size, byes, auto-bid rules, power conferences, which conferences crown no
 * champion) come from the data, never from code.
 *
 * Champions: the actual champion when `week.champions[conf]` is set, else a stand-in: the team
 * with the best conference win pct; ties -> higher in the given order, then better GWD (earlier in
 * the context's GWD order), then slug. Conferences in a format's `nonConferences` never have a champion.
 *
 * Extension: the order is extended with teams from the context's GWD order (FEI GWD order, best
 * first) that it does not contain: the best of them until the list holds `size` + 5 teams (so a full
 * field plus the first five out always exists), plus every conference champion not yet in it. The
 * appended teams keep GWD order. With an order at least `size` + 5 long, only missing champions are
 * appended.
 *
 * Auto bids: each rule in `autoBids.rules` (in order) takes its `count` highest-ranked champions
 * from its pool ('all', 'power' = champions of `powerConferences`, 'nonPower' = the other
 * champion-crowning conferences) that do not already hold a bid; then each guaranteed team ranked at
 * or above its threshold. At-large bids fill to `size` in order. Seeding is straight by rank.
 *
 * Bracket: the standard seeded bracket for the next power of two (12 -> 16 slots, 24 -> 32 slots);
 * the top nextPow2(size) - size seeds have first-round byes.
 */
import type { AutoBidPool, PlayoffFormat, WeekFile } from './types';
import { conferenceStandings } from './data';
import { gwdOrder as gwdOrderOf } from './pool';

/** How many teams the "first N out" column shows. */
export const FIRST_OUT_COUNT = 5;

/** One conference's champion candidates. */
export interface PlayoffConference {
  name: string;
  /** Decided champion (week.champions), or null. */
  champion: string | null;
  /** Teams tied for the best conference win pct (stand-in candidates); empty when `champion` is set. */
  contenders: string[];
}

/** Everything computePlayoff needs besides the order (embeddable in GameData). */
export interface PlayoffContext {
  /** Every format, default first (see {@link orderedFormats}). */
  formats: PlayoffFormat[];
  /** Conferences that crown a champion (in at least one format), by name. */
  conferences: PlayoffConference[];
  /**
   * Teams in FEI GWD order, best first (ties: higher GWD value, then slug). Extends short orders and
   * breaks champion ties. Must contain every champion and contender, and at least the GWD top
   * (largest size + 5) teams, so any order over these teams extends to a full field + five out.
   */
  gwdOrder: readonly string[];
}

/** How a team entered the field. */
export type BidType = 'champion' | 'guaranteed' | 'at-large';

/** A conference champion (actual or stand-in) and where it sits in the extended order. */
export interface ChampionEntry {
  conference: string;
  slug: string;
  /** 1-based position in the extended order. */
  rank: number;
  /** True when this is the stand-in leader, not a decided champion. */
  standIn: boolean;
  /** True when the conference is one of the format's `powerConferences`. */
  power: boolean;
}

/** A team in the field. */
export interface Seed {
  seed: number;
  slug: string;
  /** 1-based position in the extended order. */
  rank: number;
  bid: BidType;
  /** Conference, for champion bids. */
  conference?: string;
  /** The auto-bid rule pool that gave a champion bid ('all' | 'power' | 'nonPower'). */
  rule?: AutoBidPool;
}

/** One side of a bracket game: a seeded team, or the winner of an earlier game. */
export type BracketSide = { kind: 'team'; team: Seed } | { kind: 'winner'; gameId: string };

/** One bracket game. Games are listed by round, then top to bottom of the bracket. */
export interface BracketGame {
  /** "R{round}G{n}", n counting this round's games from the top of the bracket (1-based). */
  id: string;
  /** 1 = first round, increasing to the final. */
  round: number;
  /** "First round", "Second round", ..., "Quarterfinal", "Semifinal", "Final" (counted back from the final). */
  label: string;
  /** 0-based position among this round's games, top to bottom. */
  slot: number;
  /** `sides[0]` holds the better possible seed. */
  sides: [BracketSide, BracketSide];
  /** Best seed that can come out of this game. */
  slotSeed: number;
  /** Id of the game the winner plays next; null for the final. */
  next: string | null;
}

/** Output of {@link computePlayoff} for one format. */
export interface PlayoffResult {
  /** The format applied. */
  format: PlayoffFormat;
  /** The input order (deduplicated) plus the extension (module doc). Ranks refer to this list. */
  order: string[];
  /** One champion per champion-crowning conference of this format, best rank first. */
  champions: ChampionEntry[];
  /** Automatic bids (champion rules, then guaranteed teams in range), by rank. */
  autoBids: Seed[];
  /** At-large bids, by rank. */
  atLarge: Seed[];
  /** Seeds 1..size (straight seeding by rank among the field). */
  field: Seed[];
  /** Seeds with first-round byes (the top nextPow2(size) - size seeds). */
  byes: Seed[];
  /** Every game from the first round to the final, by round then bracket position. */
  games: BracketGame[];
  /** The next five teams in the order outside the field. */
  firstFiveOut: string[];
}

/** Playoff results for several formats, keyed by format id; key order = default first. */
export type PlayoffResults = Record<string, PlayoffResult>;

const cmpStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Smallest power of two >= n (1 for n <= 1). */
export function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/** The default format. @throws RangeError unless exactly one format has `default: true`. */
export function defaultFormat(formats: readonly PlayoffFormat[]): PlayoffFormat {
  const d = formats.filter((f) => f.default);
  if (d.length !== 1) throw new RangeError(`expected exactly one default playoff format, found ${d.length}`);
  return d[0]!;
}

/** Formats with the default first, then the rest in their given order. @throws RangeError as {@link defaultFormat}. */
export function orderedFormats(formats: readonly PlayoffFormat[]): PlayoffFormat[] {
  const d = defaultFormat(formats);
  return [d, ...formats.filter((f) => f !== d)];
}

/** The format with this id. @throws RangeError for an unknown id. */
export function formatById(formats: readonly PlayoffFormat[], id: string): PlayoffFormat {
  const f = formats.find((x) => x.id === id);
  if (!f) throw new RangeError(`unknown playoff format "${id}"`);
  return f;
}

/** Union of every format's nonConferences (conferences that crown no champion). */
export function nonChampionConferences(formats: readonly PlayoffFormat[]): Set<string> {
  return new Set(formats.flatMap((f) => f.nonConferences));
}

/**
 * Build the playoff context from a week file: every format (default first), every
 * champion-crowning conference with its decided champion (then `contenders` is empty) or every team
 * tied for its best conference win pct, and the full FBS GWD order. Valid for any order.
 */
export function playoffContext(week: WeekFile): PlayoffContext {
  const conferences: PlayoffConference[] = [];
  for (const st of conferenceStandings(week)) {
    if (!st.crownsChampion) continue;
    conferences.push({ name: st.conference, champion: st.champion, contenders: st.champion ? [] : st.leaders.slice() });
  }
  return { formats: orderedFormats(week.playoffFormats), conferences, gwdOrder: gwdOrderOf(week) };
}

/** Every slug a context can name as a champion (decided champions and contenders), sorted. */
export function championCandidates(ctx: PlayoffContext): string[] {
  const out = new Set<string>();
  for (const c of ctx.conferences) {
    if (c.champion) out.add(c.champion);
    for (const s of c.contenders) out.add(s);
  }
  return [...out].sort(cmpStr);
}

/** Position in the GWD order (Infinity when absent). */
function gwdPos(ctx: PlayoffContext): (s: string) => number {
  const m = new Map<string, number>();
  ctx.gwdOrder.forEach((s, i) => {
    if (!m.has(s)) m.set(s, i);
  });
  return (s) => m.get(s) ?? Infinity;
}

/**
 * Champion of each conference for an order (rule in module doc), in conference order. With a
 * format, its nonConferences are skipped.
 */
function pickChampions(
  order: readonly string[],
  ctx: PlayoffContext,
  format: PlayoffFormat | null,
): { conference: string; slug: string; standIn: boolean }[] {
  const pos = new Map<string, number>();
  order.forEach((s, i) => {
    if (!pos.has(s)) pos.set(s, i);
  });
  const nonConf = new Set(format?.nonConferences ?? []);
  const g = gwdPos(ctx);
  const out: { conference: string; slug: string; standIn: boolean }[] = [];
  for (const c of ctx.conferences) {
    if (nonConf.has(c.name)) continue;
    if (c.champion) {
      out.push({ conference: c.name, slug: c.champion, standIn: false });
      continue;
    }
    if (!c.contenders.length) continue;
    const best = [...c.contenders].sort(
      (a, b) => (pos.get(a) ?? Infinity) - (pos.get(b) ?? Infinity) || g(a) - g(b) || cmpStr(a, b),
    )[0]!;
    out.push({ conference: c.name, slug: best, standIn: true });
  }
  return out;
}

/** Sort slugs by GWD order (absent last, by slug). */
function byGwd(slugs: Iterable<string>, ctx: PlayoffContext): string[] {
  const g = gwdPos(ctx);
  return [...slugs].sort((a, b) => g(a) - g(b) || cmpStr(a, b));
}

/**
 * Champions that are not in `order` (e.g. non-pool conference leaders), in GWD order, over every
 * champion-crowning conference in the context. Independent of how `order` ranks its own teams.
 */
export function nonPoolLeaders(order: readonly string[], ctx: PlayoffContext): string[] {
  const inOrder = new Set(order);
  return byGwd(new Set(pickChampions(order, ctx, null).map((c) => c.slug).filter((s) => !inOrder.has(s))), ctx);
}

/**
 * `order` (deduplicated) extended for a field of `size` (module doc): the best non-order teams in
 * GWD order until the list holds size + 5, plus every slug in `champions` not yet in it.
 */
export function extendOrder(order: readonly string[], ctx: PlayoffContext, size: number, champions: Iterable<string> = []): string[] {
  const base = [...new Set(order)];
  const have = new Set(base);
  const champ = new Set(champions);
  let need = Math.max(0, size + FIRST_OUT_COUNT - base.length);
  const tail: string[] = [];
  for (const s of ctx.gwdOrder) {
    if (have.has(s)) continue;
    if (need > 0 || champ.has(s)) {
      if (need > 0) need--;
      tail.push(s);
      have.add(s);
    }
  }
  // Champions missing from the GWD order (malformed context): append by slug.
  for (const s of [...champ].sort(cmpStr)) {
    if (!have.has(s)) {
      tail.push(s);
      have.add(s);
    }
  }
  return base.concat(tail);
}

function ordinal(n: number): string {
  const words = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth'];
  return words[n - 1] ?? `Round ${n}`;
}

function roundLabel(round: number, totalRounds: number): string {
  const back = totalRounds - round;
  if (back === 0) return 'Final';
  if (back === 1) return 'Semifinal';
  if (back === 2) return 'Quarterfinal';
  const w = ordinal(round);
  return w.startsWith('Round') ? w : `${w} round`;
}

/** Seed numbers of a standard seeded bracket of `slots` (a power of two), top to bottom. */
export function bracketSeedOrder(slots: number): number[] {
  let order = [1];
  while (order.length < slots) {
    const n = order.length * 2;
    order = order.flatMap((s) => [s, n + 1 - s]);
  }
  return order;
}

/**
 * The standard seeded bracket for seeds 1..n (n = field.length) in nextPow2(n) slots: seeds beyond n
 * are empty, so the top nextPow2(n) - n seeds skip the first round. 12 teams: first round 8v9, 5v12,
 * 7v10, 6v11 (bracket order); quarterfinals 1 v 8/9, 4 v 5/12, 2 v 7/10, 3 v 6/11. 24 teams: first
 * round 16v17, 9v24, 13v20, 12v21, 15v18, 10v23, 14v19, 11v22; second round 1 v 16/17, 8 v 9/24,
 * 4 v 13/20, 5 v 12/21, 2 v 15/18, 7 v 10/23, 3 v 14/19, 6 v 11/22.
 * @param byes optional check: @throws RangeError when given and not nextPow2(n) - n.
 */
export function buildBracket(field: readonly Seed[], byes?: number): BracketGame[] {
  const n = field.length;
  const slots = nextPow2(n);
  if (byes !== undefined && byes !== slots - n) {
    throw new RangeError(`a standard bracket of ${n} teams has ${slots - n} byes, not ${byes}`);
  }
  type Slot = { side: BracketSide; seed: number } | null;
  let current: Slot[] = bracketSeedOrder(slots).map((s) => (s <= n ? { side: { kind: 'team', team: field[s - 1]! }, seed: s } : null));
  const totalRounds = Math.log2(slots);
  const games: BracketGame[] = [];
  const byId = new Map<string, BracketGame>();
  let round = 1;
  while (current.length > 1) {
    const next: Slot[] = [];
    let gi = 0;
    for (let i = 0; i < current.length; i += 2) {
      const a = current[i]!;
      const b = current[i + 1]!;
      if (!a || !b) {
        next.push(a ?? b); // bye (or two empty slots)
        continue;
      }
      const [hi, lo] = a.seed <= b.seed ? [a, b] : [b, a];
      const id = `R${round}G${++gi}`;
      const game: BracketGame = { id, round, label: roundLabel(round, totalRounds), slot: gi - 1, sides: [hi.side, lo.side], slotSeed: hi.seed, next: null };
      for (const side of game.sides) if (side.kind === 'winner') byId.get(side.gameId)!.next = id;
      games.push(game);
      byId.set(id, game);
      next.push({ side: { kind: 'winner', gameId: id }, seed: hi.seed });
    }
    current = next;
    round++;
  }
  return games;
}

/** Resolve a format argument: id, object, or the context's default. */
function resolveFormat(ctx: PlayoffContext, format?: string | PlayoffFormat): PlayoffFormat {
  if (format === undefined) return defaultFormat(ctx.formats);
  return typeof format === 'string' ? formatById(ctx.formats, format) : format;
}

/** Whether a champion of `conference` is in an auto-bid rule's pool for this format. */
function inRulePool(from: AutoBidPool, conference: string, f: PlayoffFormat): boolean {
  if (from === 'all') return true;
  const power = f.powerConferences.includes(conference);
  return from === 'power' ? power : !power;
}

/**
 * Field, seeds and bracket for an ordered list (best first) under one format (module doc).
 * @param format a format id, a format object, or omitted for the context's default format.
 * @throws RangeError for an unknown format id, a seeding rule other than 'straight', or a format
 *   whose byes are not nextPow2(size) - size.
 */
export function computePlayoff(order: readonly string[], ctx: PlayoffContext, format?: string | PlayoffFormat): PlayoffResult {
  const f = resolveFormat(ctx, format);
  if (f.seeding !== 'straight') throw new RangeError(`unsupported seeding "${String(f.seeding)}"`);
  if (!Number.isInteger(f.size) || f.size < 1) throw new RangeError(`bad field size ${String(f.size)}`);
  if (f.byes !== nextPow2(f.size) - f.size) {
    throw new RangeError(`format "${f.id}": ${f.byes} byes, but a standard ${f.size}-team bracket has ${nextPow2(f.size) - f.size}`);
  }
  const picked = pickChampions([...new Set(order)], ctx, f);
  const extended = extendOrder(order, ctx, f.size, picked.map((c) => c.slug));
  const rank = new Map<string, number>();
  extended.forEach((s, i) => rank.set(s, i + 1));
  const power = new Set(f.powerConferences);

  const champions: ChampionEntry[] = picked
    .map((c) => ({ ...c, rank: rank.get(c.slug)!, power: power.has(c.conference) }))
    .sort((a, b) => a.rank - b.rank || cmpStr(a.conference, b.conference));

  const bids = new Map<string, { bid: BidType; conference?: string; rule?: AutoBidPool }>();
  for (const rule of f.autoBids.rules) {
    let left = rule.count;
    for (const c of champions) {
      if (left <= 0) break;
      if (bids.has(c.slug) || !inRulePool(rule.from, c.conference, f)) continue;
      bids.set(c.slug, { bid: 'champion', conference: c.conference, rule: rule.from });
      left--;
    }
  }
  for (const g of f.autoBids.guaranteed) {
    const r = rank.get(g.slug);
    if (r !== undefined && r <= g.ifRankedAtOrAbove && !bids.has(g.slug)) bids.set(g.slug, { bid: 'guaranteed' });
  }
  const autoSlugs = [...bids.keys()].sort((a, b) => rank.get(a)! - rank.get(b)!).slice(0, f.size);
  const autoSet = new Set(autoSlugs);
  const inField = new Set(autoSlugs);
  const atLargeSlugs: string[] = [];
  for (const s of extended) {
    if (inField.size >= f.size) break;
    if (!inField.has(s)) {
      inField.add(s);
      atLargeSlugs.push(s);
    }
  }
  const fieldSlugs = [...inField].sort((a, b) => rank.get(a)! - rank.get(b)!);
  const field: Seed[] = fieldSlugs.map((slug, i) => {
    const b = autoSet.has(slug) ? bids.get(slug)! : null;
    const seed: Seed = { seed: i + 1, slug, rank: rank.get(slug)!, bid: b ? b.bid : 'at-large' };
    if (b?.bid === 'champion') {
      seed.conference = b.conference!;
      seed.rule = b.rule!;
    }
    return seed;
  });
  const bySlug = new Map(field.map((s) => [s.slug, s]));
  return {
    format: f,
    order: extended,
    champions,
    autoBids: autoSlugs.map((s) => bySlug.get(s)!),
    atLarge: atLargeSlugs.map((s) => bySlug.get(s)!),
    field,
    byes: field.slice(0, nextPow2(field.length) - field.length),
    games: buildBracket(field),
    firstFiveOut: extended.filter((s) => !inField.has(s)).slice(0, FIRST_OUT_COUNT),
  };
}

/** {@link computePlayoff} for every format in the context, keyed by format id (default first). */
export function computePlayoffs(order: readonly string[], ctx: PlayoffContext): PlayoffResults {
  const out: PlayoffResults = {};
  for (const f of orderedFormats(ctx.formats)) out[f.id] = computePlayoff(order, ctx, f);
  return out;
}
