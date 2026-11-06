/**
 * Playoff field and bracket from an ordered list (SPEC "Playoff"). The format (size, byes,
 * auto-bid rules, which conferences crown no champion) comes from the week file, never from code.
 *
 * Champions: the actual champion when `week.champions[conf]` is set, else a stand-in: the team
 * with the best conference win pct; ties -> higher in the given order, then better GWD rank, then slug.
 * Conference champions missing from the order (non-pool leaders) are appended to it in GWD order,
 * so the configured number of champions always exists. Conferences in `nonConferences` never
 * have a champion.
 */
import type { PlayoffFormat, WeekFile } from './types';
import { conferenceStandings } from './data';

/** One conference's champion candidates. */
export interface PlayoffConference {
  name: string;
  /** Decided champion (week.champions), or null. */
  champion: string | null;
  /** Teams tied for the best conference win pct (stand-in candidates). */
  contenders: string[];
}

/** Everything computePlayoff needs besides the order (embeddable in GameData). */
export interface PlayoffContext {
  format: PlayoffFormat;
  /** Only conferences that crown a champion. */
  conferences: PlayoffConference[];
  /** FEI GWD rank for (at least) every contender and champion. */
  gwdRank: Readonly<Record<string, number>>;
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
}

/** A team in the field. */
export interface Seed {
  seed: number;
  slug: string;
  /** 1-based position in the extended order. */
  rank: number;
  bid: BidType;
  /** Conference for champion bids. */
  conference?: string;
}

/** One side of a bracket game: a seeded team, or the winner of an earlier game. */
export type BracketSide = { kind: 'team'; team: Seed } | { kind: 'winner'; gameId: string };

/** One bracket game. `sides[0]` is the side holding the better possible seed. */
export interface BracketGame {
  /** e.g. "R1G1" (round 1, game 1). */
  id: string;
  /** 1 = first round, increasing to the final. */
  round: number;
  /** "First round", "Quarterfinal", "Semifinal", "Final" (counted back from the final). */
  label: string;
  sides: [BracketSide, BracketSide];
  /** Best seed that can come out of this game (bracket position). */
  slotSeed: number;
}

/** Output of {@link computePlayoff}. */
export interface PlayoffResult {
  /** The input order with missing champions appended in GWD order. Ranks refer to this list. */
  order: string[];
  /** One champion per conference, best rank first. */
  champions: ChampionEntry[];
  /** Automatic bids (best `conferenceChampions` champions + guaranteed teams in range), by rank. */
  autoBids: Seed[];
  /** At-large bids, by rank. */
  atLarge: Seed[];
  /** Seeds 1..size (straight seeding by rank among the field). */
  field: Seed[];
  /** Seeds with first-round byes. */
  byes: Seed[];
  /** Every game from the first round to the final. */
  games: BracketGame[];
  /** The next five teams in the order outside the field. */
  firstFiveOut: string[];
}

const cmpStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Build the playoff context from a week file: every champion-crowning conference with its decided
 * champion (if any; then `contenders` is empty) or every team tied for its best conference win pct,
 * and the GWD rank of every FBS team. Valid for any order.
 */
export function playoffContext(week: WeekFile): PlayoffContext {
  const conferences: PlayoffConference[] = [];
  for (const st of conferenceStandings(week)) {
    if (!st.crownsChampion) continue;
    conferences.push({ name: st.conference, champion: st.champion, contenders: st.champion ? [] : st.leaders.slice() });
  }
  const gwdRank: Record<string, number> = {};
  for (const s of Object.keys(week.teams).sort(cmpStr)) gwdRank[s] = week.teams[s]!.ranks.sor;
  return { format: week.playoff, conferences, gwdRank };
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

/** Champion of each conference for an order (rule in module doc), conference name order. */
function pickChampions(order: readonly string[], ctx: PlayoffContext): { conference: string; slug: string; standIn: boolean }[] {
  const pos = new Map<string, number>();
  order.forEach((s, i) => pos.set(s, i));
  const nonConf = new Set(ctx.format.nonConferences);
  const g = (s: string): number => ctx.gwdRank[s] ?? Infinity;
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

/**
 * Champions that are not in `order` (e.g. non-pool conference leaders), in GWD order. These are
 * exactly the teams computePlayoff appends; independent of how `order` ranks its own teams.
 */
export function nonPoolLeaders(order: readonly string[], ctx: PlayoffContext): string[] {
  const inOrder = new Set(order);
  const g = (s: string): number => ctx.gwdRank[s] ?? Infinity;
  const extra = pickChampions(order, ctx)
    .map((c) => c.slug)
    .filter((s) => !inOrder.has(s));
  return [...new Set(extra)].sort((a, b) => g(a) - g(b) || cmpStr(a, b));
}

function roundLabel(round: number, totalRounds: number): string {
  const back = totalRounds - round;
  return back === 0 ? 'Final' : back === 1 ? 'Semifinal' : back === 2 ? 'Quarterfinal' : 'First round';
}

/**
 * Bracket for seeds 1..size with the top `byes` seeds skipping the first round. Each round pairs
 * the best remaining slot with the worst (bracket position = best seed that can occupy a slot);
 * with 12 teams / 4 byes: 5v12, 6v11, 7v10, 8v9, then 1 v 8/9, 2 v 7/10, 3 v 6/11, 4 v 5/12,
 * then (1/8/9 side) v (4/5/12 side) and (2/7/10) v (3/6/11), then the final. An odd slot count
 * lets the best slot advance without a game.
 */
export function buildBracket(field: readonly Seed[], byes: number): BracketGame[] {
  type Slot = { side: BracketSide; seed: number };
  const teamSlot = (t: Seed): Slot => ({ side: { kind: 'team', team: t }, seed: t.seed });
  const pending: { round: number; idx: number; slots: [Slot, Slot] }[] = [];
  const pairUp = (slots: readonly Slot[], round: number): Slot[] => {
    const sorted = [...slots].sort((a, b) => a.seed - b.seed);
    const next: Slot[] = [];
    let lo = 0;
    let hi = sorted.length - 1;
    if (sorted.length % 2 === 1) next.push(sorted[lo++]!);
    let gi = 0;
    while (lo < hi) {
      const a = sorted[lo++]!;
      const b = sorted[hi--]!;
      gi++;
      pending.push({ round, idx: gi, slots: [a, b] });
      next.push({ side: { kind: 'winner', gameId: `R${round}G${gi}` }, seed: a.seed });
    }
    return next;
  };
  let round = 1;
  const players = field.slice(byes).map(teamSlot);
  let current: Slot[] = field.slice(0, byes).map(teamSlot);
  if (players.length > 0) {
    current = current.concat(pairUp(players, round));
    round++;
  }
  while (current.length > 1) {
    current = pairUp(current, round);
    round++;
  }
  const totalRounds = round - 1;
  return pending.map((p) => ({
    id: `R${p.round}G${p.idx}`,
    round: p.round,
    label: roundLabel(p.round, totalRounds),
    sides: [p.slots[0].side, p.slots[1].side],
    slotSeed: p.slots[0].seed,
  }));
}

/**
 * Field, seeds and bracket for an ordered list (best first). See module doc for champions.
 * Auto bids = the `conferenceChampions` highest-ranked champions + each guaranteed team ranked at
 * or above its threshold; at-large bids fill to `size` in order; seeding is straight by rank.
 * @throws RangeError for a seeding rule other than 'straight'.
 */
export function computePlayoff(order: readonly string[], ctx: PlayoffContext): PlayoffResult {
  const f = ctx.format;
  if (f.seeding !== 'straight') throw new RangeError(`unsupported seeding "${String(f.seeding)}"`);
  const base = [...new Set(order)];
  const extended = base.concat(nonPoolLeaders(base, ctx));
  const rank = new Map<string, number>();
  extended.forEach((s, i) => rank.set(s, i + 1));

  const champions: ChampionEntry[] = pickChampions(extended, ctx)
    .map((c) => ({ ...c, rank: rank.get(c.slug)! }))
    .sort((a, b) => a.rank - b.rank || cmpStr(a.conference, b.conference));

  const bids = new Map<string, { bid: BidType; conference?: string }>();
  for (const c of champions.slice(0, f.autoBids.conferenceChampions)) {
    if (!bids.has(c.slug)) bids.set(c.slug, { bid: 'champion', conference: c.conference });
  }
  for (const g of f.autoBids.guaranteed) {
    const r = rank.get(g.slug);
    if (r !== undefined && r <= g.ifRankedAtOrAbove && !bids.has(g.slug)) bids.set(g.slug, { bid: 'guaranteed' });
  }
  let autoSlugs = [...bids.keys()].sort((a, b) => rank.get(a)! - rank.get(b)!);
  if (autoSlugs.length > f.size) autoSlugs = autoSlugs.slice(0, f.size);
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
    const b = bids.get(slug);
    const seed: Seed = { seed: i + 1, slug, rank: rank.get(slug)!, bid: b && autoSlugs.includes(slug) ? b.bid : 'at-large' };
    if (b?.conference && seed.bid === 'champion') seed.conference = b.conference;
    return seed;
  });
  const bySlug = new Map(field.map((s) => [s.slug, s]));
  const byes = Math.min(f.byes, field.length);
  return {
    order: extended,
    champions,
    autoBids: autoSlugs.map((s) => bySlug.get(s)!),
    atLarge: atLargeSlugs.map((s) => bySlug.get(s)!),
    field,
    byes: field.slice(0, byes),
    games: buildBracket(field, byes),
    firstFiveOut: extended.filter((s) => !inField.has(s)).slice(0, 5),
  };
}
