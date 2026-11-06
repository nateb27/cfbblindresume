# src/lib — shared library API

Pure, deterministic TypeScript (strict). No DOM, no `Math.random()` (randomness only through an
injected `Rng`), no Node APIs except in `data-node.ts`. The weekly JSON (`types.ts`) is the only
data source; nothing here hard-codes teams, counts, conferences or playoff rules. Import with the
`@lib/*` alias, and use `import type` for types (`verbatimModuleSyntax` is on).

`types.ts` is unchanged by this work (no schema additions were needed).

## Typical game flow

This block type-checks against the repo tsconfig (only `season`, `week` and `askUser` come from the UI).

```ts
import { agreement, agreementSentence, runningLine } from '@lib/agreement';
import {
  computeRunResults,
  gameAgreementRefs,
  gameDataPath,
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
const results: RunResults = computeRunResults(gd, rounds); // ranking, playoff bracket, agreement
const sentence = agreementSentence(results.agreement);     // "Of your 45 head-to-head calls, ..."
const code = encodeRun({ season: gd.season, week: gd.week, rounds }, gd.slugs);
void sentence;

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
- `opponentOf(week, game): OpponentRef` — resolves FBS / non-FBS opponents (throws on dangling refs).
- `gameRows(week, slug): GameRow[]` — opponent, tier, site, result, margin (pf - pa); toughest first: tier, then opponent FEI rank, then date.
- `resumeStrip(week, slug): StripEntry[]` — chronological dots (result, tier, margin, site).
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
- `loadWeek(season, week, opts?): WeekFile` — throws if missing or schemaVersion differs.
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
- `crc16ccitt(bytes)`, `base64urlEncode(bytes)`, `base64urlDecode(str)` — primitives.

## playoff.ts
- `playoffContext(week): PlayoffContext` — format + champion candidates per conference (decided champion, or all teams tied for the best conference pct) + GWD ranks.
- `championCandidates(ctx): string[]` — every slug the context can name as a champion.
- `computePlayoff(order, ctx): PlayoffResult` — `{ order (extended), champions, autoBids, atLarge, field (seeds), byes, games, firstFiveOut }`. Missing champions are appended in GWD order automatically.
- `nonPoolLeaders(order, ctx): string[]` — champions not in `order`, GWD order.
- `buildBracket(field, byes): BracketGame[]` — 5v12, 6v11, 7v10, 8v9; QF 1 v 8/9, 2 v 7/10, 3 v 6/11, 4 v 5/12; SF; final.

## agreement.ts
- `agreement(rounds, { committee, fei }): AgreementSummary` — per-round match, rounds matched, pairwise matches. A round where the reference orders none of the three pairs (e.g. three teams outside the committee top 25) counts as a match, so with a committee release `roundsMatched.*.comparable` equals the rounds played; a round is `null` only when the committee is absent.
- `roundAgreement(round, ref)`, `pairwiseAgreement(rounds, ref)`, `referenceOrder(a, b, ref)` — building blocks (both-unranked pairs ignored).
- `agreementSentence(summary)` — "Of your 45 head-to-head calls, 32 matched the committee (71%) and 38 matched FEI (84%)."
- `runningLine(summary)` — "You've matched the committee in 4 of 6 rounds, FEI in 5 of 6." ("1 of 1 round" after the first round).

## game-data.ts
- `buildGameData(week): GameData` — compact island payload (`/game-data/{season}-{week}.json`): prior, cards (record, sor/off/def/sos ranks, game tuples, strip, quality), h2h index, teams (identity + committee/GWD ranks for the pool, the FEI top 30 and every champion candidate), slugs, committee top 25, `feiOrder` (GWD top 30), playoff format, conference champion candidates, non-pool leaders, tier legend. Any order over these teams works with `computePlayoff(order, gamePlayoffContext(gd))`.
- `gameDataPath(season, week)` — `/game-data/{season}-{week}.json`.
- `h2hKey(a, b)` / `headToHeadFlags(gd, trio): H2HFlag[]` — head-to-head flags above the cards.
- `gameTrioState(gd, rounds)`, `gamePlayoffContext(gd)`, `gameAgreementRefs(gd)` — adapters for the modules above.
- `computeRunResults(gd, rounds): RunResults` — `{ ranking, playoff, agreement, partial }`; same result in the island and the OG-image Function.
- `gameRunViolations(gd, rounds): string[]` — validate decoded runs before computing results.
- Card tuples: `CardGame = [tier, site 'h'|'a'|'n', 'W'|'L', margin]`, `StripDot = [tier, 'W'|'L']`; `tier` indexes `gd.tiers`.
