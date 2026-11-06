# src/lib — shared library API

Pure, deterministic TypeScript (strict). No DOM, no `Math.random()` (randomness only through an
injected `Rng`), no Node APIs except in `data-node.ts`. The weekly JSON (`types.ts`) is the only
data source; nothing here hard-codes teams, counts, conferences or playoff rules. Import with the
`@lib/*` alias, and use `import type` for types (`verbatimModuleSyntax` is on).

## Schema v2: playoff formats (breaking change)

`SCHEMA_VERSION` is 2. The week file's single `playoff: PlayoffFormat` became
`playoffFormats: PlayoffFormat[]` (exactly one `default: true`; 2026: `12-team` current/default and
`24-team` proposed). Each `PlayoffFormat` gained `id`, `label`, `status` ('current' | 'proposed'),
`default`, `note` (one sentence for the UI), `sourceName`, `checkedOn` and `powerConferences`;
`autoBids.conferenceChampions` became `autoBids.rules: { from: 'all' | 'power' | 'nonPower'; count }[]`.
`size`, `byes` (always `nextPow2(size) - size`), `seeding`, `guaranteed`, `nonConferences`, `sourceUrl`
keep their meaning. `data-node.ts` loads schemaVersion 2 only. UI code never hard-codes either format:
iterate `playoffFormats` / the keys of `RunResults.playoffs`, show `label`, `note`, `sourceName` +
`sourceUrl`, and label `status: 'proposed'` formats "Proposed for 2027 — not final".

Migration for callers: `week.playoff` -> `week.playoffFormats` (default: `defaultFormat(...)`);
`gd.playoff` -> `gd.playoffFormats` (default first); `ctx.format` -> `ctx.formats`; `ctx.gwdRank` ->
`ctx.gwdOrder`; `computePlayoff(order, ctx)` still returns the default format and takes an optional
format id; `RunResults.playoff` is still the default format, `RunResults.playoffs` has all of them.

## Typical game flow

This block type-checks against the repo tsconfig (only `season`, `week` and `askUser` come from the UI).

```ts
import { agreement, agreementSentence, runningLine } from '@lib/agreement';
import {
  computeRunResults,
  gameAgreementRefs,
  gameDataPath,
  gamePlayoffs,
  gameRunViolations,
  gameTrioState,
  headToHeadFlags,
  type GameData,
  type H2HFlag,
  type RunResults,
} from '@lib/game-data';
import { rngForRound } from '@lib/rng';
import { encodeRun, parseShareCode, resolveShareCode, type ShareCodeError } from '@lib/sharecode';
import { nextTrio, TRIO_RULES, type Trio } from '@lib/trios';

declare const season: number, week: number;                            // current week (from the page)
declare function askUser(trio: Trio, flags: H2HFlag[]): Promise<Trio>; // UI: the user's [1st, 2nd, 3rd]

// Play: fetch the week, then 15 rounds (up to TRIO_RULES.maxRounds = 30 with "Do another").
const gd: GameData = await (await fetch(gameDataPath(season, week))).json();
const seed = (Math.random() * 2 ** 32) >>> 0;  // the island may use Math.random for the seed only
const rounds: Trio[] = [];                     // each round = [1st, 2nd, 3rd] in the user's order
while (rounds.length < TRIO_RULES.baseRounds) {
  const trio = nextTrio(gameTrioState(gd, rounds), rngForRound(seed, rounds.length + 1)); // display order
  if (!trio) break;                            // null only after round 30
  const flags = headToHeadFlags(gd, trio);     // "B beat A head-to-head · +16"
  rounds.push(await askUser(trio, flags));
  const reveal = runningLine(agreement(rounds, gameAgreementRefs(gd))); // "You've matched the committee in 4 of 6 rounds, FEI in 5 of 6."
  void reveal;
}
const results: RunResults = computeRunResults(gd, rounds); // ranking, playoff brackets, agreement
const sentence = agreementSentence(results.agreement);     // "Of your 45 head-to-head calls, ..."
const code = encodeRun({ season: gd.season, week: gd.week, rounds }, gd.slugs);
void sentence;

// Playoff formats: one result per format, keyed by id, default first ("12-team", then "24-team").
// The segmented control lists gd.playoffFormats (default first); each result carries its format.
for (const [id, p] of Object.entries(results.playoffs)) {
  const f = p.format;                          // f.id === id; f.label "12 teams"; f.status; f.note; f.sourceName/sourceUrl
  const seeds = p.field.map((s) => s.slug);    // seeds 1..size; p.byes, p.autoBids (s.rule 'all'|'power'|'nonPower'), p.atLarge
  const out = p.firstFiveOut;                  // always 5 teams (orders are extended in GWD order)
  const firstRound = p.games.filter((g) => g.round === 1); // bracket order, top to bottom; g.next links rounds
  void [f, seeds, out, firstRound];
}
// Other tabs (committee, FEI, fans) use the same helper over any order of gd teams:
const committeeFields = gd.committee ? gamePlayoffs(gd, gd.committee) : null; // Record<formatId, PlayoffResult>
void committeeFields;

// /r/{code}: the island, the /r Function and the OG-image Function all use this sequence (the
// Functions fetch the JSON through env.ASSETS). The week's slugs come from an async fetch, so
// decode in two stages; decodeRun(code, slugsFor) is only for when the slugs are already in memory.
async function openShared(code: string): Promise<RunResults | ShareCodeError | string[]> {
  const raw = parseShareCode(code);            // base64, version, checksum, length, duplicates
  if (!raw.ok) return raw.error;
  const res = await fetch(gameDataPath(raw.value.season, raw.value.week)); // the code's week
  const wk: GameData | null = res.ok ? await res.json() : null;
  const run = resolveShareCode(raw.value, wk?.slugs); // kind 'week-not-found' when wk is null
  if (!run.ok) return run.error;               // ok implies wk was loaded
  const problems = gameRunViolations(wk!, run.value.rounds); // non-pool teams, repeats, caps, coverage
  if (problems.length) return problems;
  return computeRunResults(wk!, run.value.rounds);
}
void openShared(code);
```

## tiers.ts
- `TIERS: readonly Tier[]` — the 9 opponent tiers, toughest first (`order` = index).
- `tierFor(opp: { fbs; feiRank?; classification? }): Tier` — `{ key, stars, label, order }`; throws on an FBS opponent without a rank.
- `rankFill(rank, fbsCount): number` — bar fill 0..1 (rank 1 = 1, rank n = 0), clamped.

## rng.ts (additive)
- `type Rng = () => number` — uniform [0, 1).
- `mulberry32(seed): Rng` — seeded generator.
- `rngForRound(seed, round): Rng` — per-round generator; makes trio selection reproducible from (pool, prior, picks, seed).
- `hash32(a, b)`, `randInt(rng, n)`, `shuffled(items, rng)` — helpers.

## pool.ts
- `gwdOrder(week): string[]` — all FBS slugs by GWD rank (`ranks.sor`), ties: higher GWD value, then slug.
- `committeeOrder(week): string[] | null` — committee top 25 (throws on unknown slugs).
- `gwdTop(week, n = 25): string[]` — teams with GWD rank <= n (ties included), GWD order.
- `prior(week): string[]` — committee order, then non-committee GWD top 25 in GWD order; GWD top 25 if no committee.
- `pool(week): string[]` — same list as `prior` (the pool, in prior order).
- `positions(order): Map<string, number>` — slug -> 1-based position.

## data.ts (re-exports pool.ts)
- `teamList(week): Team[]` — FBS teams sorted by name.
- `team(week, slug): Team` — lookup (throws if unknown).
- `fbsSlugsSorted(week): string[]` — sorted slugs (share-code index space).
- `opponentOf(week, game): OpponentRef` — resolves FBS / non-FBS opponents of a game or scheduled game (throws on dangling refs).
- `gameRows(week, slug): GameRow[]` — opponent, tier, site, result, margin (pf - pa); toughest first: tier, then opponent FEI rank, then date.
- `resumeStrip(week, slug): StripEntry[]` — chronological dots (result, tier, margin, site).
- `upcomingRows(week, slug): UpcomingRow[] | null` — the remaining schedule ("Still to play", additive `Team.upcoming`), chronological: week, date, opponent ref, opponent tier (current FEI rank), site, conf, `oppCommittee` (opponent's committee rank or null). `null` when the file carries no schedules (unknown, not "none left").
- `qualityWins(week, slug): QualityWins` — `{ top10, r11to25, r26to50 }` as `{ w, l }` vs current FEI rank buckets.
- `headToHead(week, a, b): H2HGame[]` — meetings with winner, loser, points, margin, winner's site.
- `trioHeadToHead(week, slugs): H2HGame[]` — every meeting among a trio (3+ when all played each other).
- `deltas(week): DeltaRow[]` — pool teams: committee rank, GWD rank, delta = committee - GWD (null if unranked).
- `bubble(week, { from = 8, to = 20 }): DeltaRow[]` — committee 8-20 sorted by GWD rank; [] without a committee.
- `comparePairs(week): ComparePair[]` — all C(25,2) = 300 committee pairs, better rank first, `slug` = "a-vs-b".
- `nearestCompares(week, slug, n = 3): ComparePair[]` — nearest committee neighbors (ties: better-ranked first); [] if unranked.
- `conferenceStandings(week): ConferenceStanding[]` — per conference: sorted rows, `leaders` (tied best conf pct), `champion`, `crownsChampion`.
- `winPct(w, l)`, `priorPositions(week)`, `gwdRanks(week)` — helpers.

## data-node.ts (Node only: Astro build, tests)
- `loadSeasonIndex(season, opts?): SeasonIndex` — data/{season}/index.json (rebuilt from week files if missing).
- `loadWeek(season, week, opts?): WeekFile` — throws if missing or schemaVersion is not 2 (`SCHEMA_VERSION`).
- `loadAllWeeks(season, opts?): WeekFile[]` — every week in order.
- `loadLatest(opts?): WeekFile` — newest week of the newest season.
- `listSeasons(opts?)`, `dataDir(opts?)`, `weekPath(...)` — helpers. Data dir: `opts.dataDir` > `$CFB_DATA_DIR` > `<cwd>/data`.

## bradley-terry.ts
- `bradleyTerry(ids, comparisons, { sigma = 1, mean?, maxIter?, tol? }): BTResult` — MAP fit (Newton), Gaussian prior; finite under perfect separation. Comparisons may carry `weight` (vote counts).
- `BTResult`: `theta`, `strength`, `covariance` (Laplace), `prob(a, b)`, `probMarginal(a, b)`, `diffVariance(a, b)`, `order()`, `converged`.
- `logistic(x)` — stable logistic.

## isotonic.ts (additive)
- `isotonicRegression(p, constraints): number[]` — exact L2 isotonic regression on a DAG (x[a] <= x[b]) by recursive max-weight-closure partitioning; exact for integer p.
- `MaxFlow` — small Dinic max-flow used above.

## ranking.ts
- `rankFromPicks(prior, rounds): RankingResult` — committee prior + ranked pairs + isotonic projection. `{ order, unseen: Set, x, acceptedEdges, droppedEdges }`. No contradicting pick -> `order` equals `prior`.
- `pairwiseOutcomes(rounds): [winner, loser][]` — 1st>2nd, 1st>3rd, 2nd>3rd per round.
- `netEdges(prior, rounds): PickEdge[]` — net-win edges (weight = |net|).
- `rankedPairsOrder(prior, edges): PickEdge[]` — Tideman order: weight, prior-agreeing first, smaller prior gap, slugs.

## trios.ts
- `nextTrio(state: TrioState, rng): Trio | null` — next trio in shuffled display order; null after round 30 (or if no legal trio exists — never for pools of 25..45).
- `TrioState` — `{ prior, gwdRank?, rounds }` (rounds in the user's order).
- `TRIO_RULES` — 15 base rounds, 30 max, caps 3/6, window 8 for rounds 1-8, coverage for pools <= 45.
- `capFor(round)` — 3 through round 15, 6 after.
- `isValidRun(rounds, pool?): boolean` / `runViolations(rounds, pool?): string[]` — hard-rule check (repeats, caps, pool membership, coverage by round 15).
- `windowFeasible(state): boolean` — whether a windowed (spread <= 8) legal trio exists for the next round.
- Re-exports `mulberry32`, `rngForRound`, `Rng`.

## sharecode.ts
- `encodeRun({ season, week, rounds }: RunToEncode, slugs): string` — base64url, no padding; `rounds` is any `readonly (readonly string[])[]` (e.g. `Trio[]`); throws on invalid input (not 3 distinct known slugs, 0 or > 30 rounds).
- `decodeRun(code, slugsFor): ShareCodeResult<SharedRun>` — synchronous `slugsFor`; never throws; `{ ok: false, error: { kind, message, ... } }` with kind `bad-base64 | version | length | checksum | round-count | duplicate-team | index-out-of-range | week-not-found`.
- `parseShareCode(code)` / `resolveShareCode(raw, slugs)` — the two decode stages; use them when the week's slugs come from an async fetch (see the flow above).
- Kind `version` means a newer format (version byte 2..15, `FUTURE_SHARE_CODE_VERSIONS`) with an intact checksum; future versions keep byte 0 and the trailing CRC-16. Garbled, truncated or lowercased codes report `checksum` / `length` / `bad-base64`, never `version`.
- `crc16ccitt(bytes)`, `base64urlEncode(bytes)`, `base64urlDecode(str)` — primitives.

## playoff.ts (generalized to any PlayoffFormat)
- `playoffContext(week): PlayoffContext` — `{ formats (default first), conferences, gwdOrder }`: every format, every champion-crowning conference's decided champion or the teams tied for its best conference pct, and the full FBS GWD order.
- `computePlayoff(order, ctx, format?): PlayoffResult` — one format (`format` = id or object; omitted = default). `{ format, order (extended), champions, autoBids, atLarge, field (seeds), byes, games, firstFiveOut }`.
- `computePlayoffs(order, ctx): PlayoffResults` — every format, `Record<formatId, PlayoffResult>`, key order default first.
- Extension: the order is deduplicated, then extended with the best non-order teams in GWD order until it holds `size + 5`, plus any champion still missing (GWD order). So the 24-team field + first five out always exist, even from the committee 25 or an empty order. A long order (>= size + 5) only gets missing champions appended.
- Champions: decided champion, else best conference pct; ties -> higher in the order, then earlier in GWD order. `ChampionEntry.power` marks power-conference champions.
- Auto bids: `autoBids.rules` in order, each taking its `count` best-ranked champions from `'all'`, `'power'` (conference in `powerConferences`) or `'nonPower'` (any other champion-crowning conference) without a bid yet; then guaranteed teams ranked at or above their threshold. `Seed.rule` records the pool of a champion bid. 12-team: 5 best champions + Notre Dame if top 12. 24-team: 4 power champions (a power champion ranked 30th still gets in) + the single best other champion; 19 at-large.
- Bracket (`buildBracket(field, byes?)`): the standard seeded bracket for `nextPow2(n)` slots; the top `nextPow2(n) - n` seeds have byes. Games are listed by round, then top to bottom: `{ id 'R{round}G{n}', round, label ('First round', 'Second round', 'Quarterfinal', 'Semifinal', 'Final'), slot, sides (better seed first), slotSeed, next }`. 12: R1 8v9, 5v12, 7v10, 6v11; QF 1 v 8/9, 4 v 5/12, 2 v 7/10, 3 v 6/11. 24: R1 16v17, 9v24, 13v20, 12v21, 15v18, 10v23, 14v19, 11v22; R2 1 v 16/17, 8 v 9/24, 4 v 13/20, 5 v 12/21, 2 v 15/18, 7 v 10/23, 3 v 14/19, 6 v 11/22. `byes`, when given, must equal `nextPow2(n) - n`.
- `computePlayoff` throws `RangeError` for an unknown format id, non-'straight' seeding, or `byes != nextPow2(size) - size`.
- `defaultFormat(formats)`, `orderedFormats(formats)` (default first), `formatById(formats, id)` — throw `RangeError` unless exactly one default / on unknown id. `nonChampionConferences(formats)`, `nextPow2(n)`, `bracketSeedOrder(slots)`, `extendOrder(order, ctx, size, champions?)`, `FIRST_OUT_COUNT` (5).
- `championCandidates(ctx): string[]` — every slug the context can name as a champion.
- `nonPoolLeaders(order, ctx): string[]` — champions not in `order`, GWD order.

## agreement.ts
- `agreement(rounds, { committee, fei }): AgreementSummary` — per-round match, rounds matched, pairwise matches. A round where the reference orders none of the three pairs (e.g. three teams outside the committee top 25) counts as a match, so with a committee release `roundsMatched.*.comparable` equals the rounds played; a round is `null` only when the committee is absent.
- `roundAgreement(round, ref)`, `pairwiseAgreement(rounds, ref)`, `referenceOrder(a, b, ref)` — building blocks (both-unranked pairs ignored).
- `agreementSentence(summary)` — "Of your 45 head-to-head calls, 32 matched the committee (71%) and 38 matched FEI (84%)."
- `runningLine(summary)` — "You've matched the committee in 4 of 6 rounds, FEI in 5 of 6." ("1 of 1 round" after the first round).

## game-data.ts
- `buildGameData(week): GameData` (`v: 2`) — compact island payload (`/game-data/{season}-{week}.json`, emitted by `src/pages/game-data/[file].json.ts` for every week file): prior, cards (record, sor/off/def/sos ranks, game tuples, strip, quality), h2h index, teams (identity + committee/GWD ranks for the pool, the GWD top 40 (`GWD_DEPTH`, raised to the largest field + 5 if needed) and every champion candidate), `gwdOrder` (every listed team in GWD order), slugs, committee top 25, `feiOrder` (GWD top 30), `playoffFormats` (all formats, default first), conference champion candidates, non-pool leaders, tier legend. Any order over these teams gives the same playoff results as the week file, for every format.
- `gameDataPath(season, week)` — `/game-data/{season}-{week}.json`.
- `h2hKey(a, b)` / `headToHeadFlags(gd, trio): H2HFlag[]` — head-to-head flags above the cards.
- `gameTrioState(gd, rounds)`, `gamePlayoffContext(gd)`, `gameAgreementRefs(gd)` — adapters for the modules above.
- `gamePlayoffs(gd, order): PlayoffResults` — every format for any order (committee / FEI / fans tabs), keyed by id, default first.
- `computeRunResults(gd, rounds): RunResults` — `{ ranking, playoff (default format), playoffs (all formats keyed by id, default first), agreement, partial }`; same result in the island and the OG-image Function (which uses `playoff`, the default 12).
- `gameRunViolations(gd, rounds): string[]` — validate decoded runs before computing results.
- Card tuples: `CardGame = [tier, site 'h'|'a'|'n', 'W'|'L', margin]`, `StripDot = [tier, 'W'|'L']`; `tier` indexes `gd.tiers`.
