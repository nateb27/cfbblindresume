# cfbblindresume.com — build spec

This is the contract every part of the build follows. The original site plan is the background;
where this spec differs from it, this spec wins (changes are listed in "Deviations from the plan"
and must also appear in README.md).

## Product in one paragraph

An independent College Football Playoff resume site. Two halves: (1) a blind-resume game —
15 rounds, three anonymized resumes per round, rank them 1-2-3, see a reveal, finish with your
own top 25 and 12-team bracket compared against the committee and an independent model; and
(2) static content pages (one per FBS team, weekly rankings, pairwise compares, bubble) that
Google ranks. Every number comes from FEI by Brian Fremeau (bcftoys.com) or is computed from
raw scores. Tagline: "Same game. Different numbers."

## House rules (non-negotiable)

1. **No ESPN-produced number anywhere**: no FPI, ESPN strength of record, Game Control, SP+,
   F+, ESPN efficiency or win probability. The strings "ESPN", "FPI", "SP+", "Game Control"
   may appear in built output ONLY on /about, in its single statement of what the site does
   not use. Not in code comments that ship, not in alt text, not in JSON shipped to the client.
2. **No logos, no ESPN-hosted images.** Team identity = school name in condensed caps + a color
   block in the team's primary color + a 4px rule in its secondary color. Never load
   `logos` URLs from CFBD.
3. **Do not copy ESPN's visual design.** Structure (three blind cards, rank, reveal, results with
   bracket) is shared; the look is ours: no red slanted badges, no sunburst/ray backgrounds, no
   "?" badge in a red square, no dashed card borders, no Graduate/Rye/Oswald fonts, no red
   accent. Our palette and type are below.
4. **Content pages are complete static HTML** readable with JavaScript disabled. The game
   (home `/` and `/r/*`) is the only interactive island.
5. **Ads** live only in fixed, height-reserved slots on content pages (plus one below the game
   container and one on results, outside the play area), behind `PUBLIC_ADS` (default `off`).
   Nothing inside game cards or modals. No interstitials, sticky banners or autoplay video.
6. **Privacy**: no accounts, no cookies set by the site, no localStorage of personal data
   (a localStorage flag for "skip reveal" and "seen intro" is fine). The only stored personal
   data is a salted, hashed IP for rate limiting, deleted after 24 hours.
7. **Data-driven**: the weekly JSON (`src/lib/types.ts`) is the single source of truth. No
   hard-coded team names, ranks, counts (there are 138 FBS teams in 2026, not 136), conference
   lists or playoff rules in application code. Tests may use fixtures.
8. **Attribution** "Ratings: FEI by Brian Fremeau" linking to https://bcftoys.com/{season}-fei
   on every game card (results/reveal included) and in the footer of every content page.

## Repository layout

```
/data/{season}/week-{N}.json   weekly snapshots (pipeline output, committed)
/data/{season}/index.json      SeasonIndex: list of weeks
/pipeline/                     Python 3.12+: fetch, join, validate, write  (owner: pipeline)
/src/lib/                      shared pure TypeScript, no DOM, no Node APIs except in data-node.ts
/src/pages/                    Astro routes                                 (owner: content)
/src/layouts/, /src/components/  shared Astro UI                            (owner: content)
/src/game/                     React island                                 (owner: game)
/src/styles/                   tokens.css + global.css                      (owner: content; game may add game.css)
/functions/                    Cloudflare Pages Functions                   (owner: backend)
/migrations/                   D1 SQL migrations                            (owner: backend)
/tests/                        vitest unit tests (+ pipeline tests in pipeline/tests)
/scripts/                      build/verification helpers (lighthouse, grep, sitemap check)
```

Do not edit files owned by another area unless the task says so. Do not edit package.json;
if you need a dependency, install it with `npm i` and say so in your report (backend may keep
its own deps in package.json too; coordinate by reporting).

## Data

### Sources (verified live on 2026-11-05)

| What | Source | Notes |
| --- | --- | --- |
| FEI, OFEI, DFEI, ELS, GWD (+ ranks) | `https://bcftoys.com/{season}-fei` | One static HTML table, 138 rows. Columns: Rk, Team, Rec, FBS, FEI, OFEI, Rk, DFEI, Rk, SFEI, Rk, ELS, Rk, GLS, Rk, ALS, Rk, EWD, Rk, GWD, Rk, AWD, Rk. Header text says "(through Week N)". Values like ".65" / "-.55". Header row repeats every 15 rows. |
| Games, sites, scores | CFBD `GET /games?year=Y&seasonType=regular` | Key injected by proxy (send header `Authorization: Bearer $CFBD_API_KEY`; locally the env var may be a placeholder). Fields: week, startDate, completed, neutralSite, conferenceGame, homeId/homeTeam/homeClassification/homePoints, away*. |
| FBS teams, colors, conference | CFBD `GET /teams/fbs?year=Y` | 138 teams. `color`, `alternateColor`, `abbreviation`, `mascot`, `conference`. Ignore `logos`. |
| Committee top 25 | `https://collegefootballplayoff.com/rankings` (primary, HTML "Full Rankings 1 Miami 8-0 2 Georgia ...") and CFBD `GET /rankings?year=Y&seasonType=regular` poll `"Playoff Committee Rankings"` (cross-check / fallback) | First release Nov 3, 2026 (CFBD files it under week 10). Both agreed on 2026-11-03. |

Name aliases needed (FEI name -> CFBD school): Appalachian State -> App State, Connecticut -> UConn,
Hawaii -> Hawai'i, San Jose State -> San José State, Southern Mississippi -> Southern Miss.
CFP site uses "Southern California" -> USC. Keep these in `pipeline/aliases.json`; the validator
fails loudly on any unmatched name rather than guessing.

### Week numbering

The snapshot built on 2026-11-05 contains games through week 9, FEI "through Week 9", and the
Nov 3 committee release: it is `data/2026/week-9.json`, label "After Week 9". The weekly
rankings archive URL is `/rankings/2026/week-9`.

### Playoff format (2026), stored in the week file

`size: 12, byes: 4, seeding: 'straight', autoBids: { conferenceChampions: 5, guaranteed:
[{ slug: 'notre-dame', ifRankedAtOrAbove: 12 }] }, nonConferences: ['FBS Independents']`.
The pipeline writes this from `pipeline/playoff_format.json` (hand-maintained config, the one
place it lives). Verify against collegefootballplayoff.com's format page if reachable and record
the URL in `sourceUrl`.

### Opponent tiers (cut on opponent's overall FEI rank)

| FEI rank | Stars | Label |
| --- | --- | --- |
| 1-5 | 5 | FEI 1-5 team |
| 6-10 | 4.5 | FEI 6-10 team |
| 11-25 | 4 | FEI 11-25 team |
| 26-50 | 3 | FEI 26-50 team |
| 51-75 | 2 | FEI 51-75 team |
| 76-100 | 1.5 | FEI 76-100 team |
| 101+ | 1 | FEI 101+ team |
| non-FBS, classification fcs | 0.5 | FCS team |
| non-FBS, other | 0.5 | Non-FBS team |

Opponent tier is computed at render time from the CURRENT week's ranks.

## Shared library `src/lib/` (owner: algorithms) — public API

All pure functions, deterministic, no `Math.random()` except where an injected `rng` is used.

- `types.ts` — schema (exists; do not change field meanings; additive changes allowed with a note).
- `tiers.ts` — `tierFor(opp: {fbs: boolean; feiRank?: number; classification?: string})` →
  `{ key, stars, label, order }`; `rankFill(rank, fbsCount)` → 0..1 (rank 1 = 1, rank n = 0).
- `data.ts` — pure derivations on a `WeekFile`: `teamList`, `gameRows(week, slug)` (opponent,
  tier, site, margin, sorted toughest first; tie-break by date), `resumeStrip` (chronological),
  `qualityWins` (vs top 10 / 11-25 / 26-50 by FEI rank), `headToHead(week, a, b)` → list of
  games between a and b with winner and margin, `committeeOrder`, `gwdOrder`, `pool(week)`,
  `prior(week)`, `deltas` (committee rank minus GWD rank), `bubble(week)`, `comparePairs(week)`,
  `nearestCompares(week, slug, 3)`, `conferenceStandings(week)`.
- `data-node.ts` — Node-only loaders for Astro build: `loadSeasonIndex(season)`, `loadWeek(season, week)`,
  `loadLatest()`, `loadAllWeeks(season)` (reads /data via fs).
- `pool.ts` — pool = committee top 25 ∪ FEI GWD top 25 (just GWD top 25 if no committee).
  Prior order = committee order, then pool teams not ranked by the committee in GWD order.
  If no committee: prior = GWD order.
- `ranking.ts` — the user's ranking from picks (algorithm below).
- `bradley-terry.ts` — MAP Bradley-Terry with Gaussian prior; returns strengths and
  per-pair win probabilities and variances (Laplace). Used for adaptive trio selection and
  the fans consensus ranking. Must handle perfect separation (finite thanks to the prior).
- `trios.ts` — trio selection (rules below), with an injected seeded RNG (`mulberry32(seed)`).
- `sharecode.ts` — encode/decode runs (format below).
- `playoff.ts` — champions, auto bids, at-large, seeds, bracket pairings, first five out.
- `agreement.ts` — per-round match and pairwise agreement with committee and FEI.
- `game-data.ts` — `buildGameData(week): GameData`: the compact payload the island needs
  (pool teams' blind cards: record, ranks sor/off/def/sos, game rows with tiers, resume strip,
  quality wins; head-to-head index; names/colors/committee/GWD ranks for reveal; prior; all FBS
  slugs sorted for share codes; playoff format; conference standings; non-pool conference
  leaders for the bracket). Emitted at build as `/game-data/{season}-{week}.json`.

### Ranking algorithm (`ranking.ts`)

Goal: "We start from the committee's ranking and move teams with your picks." Guarantees:
(a) if no pick contradicts the prior, the output equals the prior exactly (this makes plan
criterion 7 hold: always picking the higher committee rank yields the committee top 25);
(b) every direct pick is respected unless it conflicts with stronger evidence in a cycle;
(c) transitive implications are respected.

1. Each ranked trio [1st, 2nd, 3rd] yields pairwise outcomes 1st>2nd, 1st>3rd, 2nd>3rd.
2. Net wins per pair; an edge winner→loser with weight = |net|; net 0 → no edge.
3. Ranked pairs (Tideman) to break cycles: sort edges by weight desc, then edges agreeing with
   the prior before upsets, then smaller prior gap first, then slug order; add each edge unless
   it creates a cycle. Accepted edges form a DAG.
4. Isotonic projection: x minimizing Σ (x_i − p_i)² subject to x_w ≤ x_l for every accepted edge,
   where p_i = 1-based prior position. Exact or converged to 1e-9 (n ≤ 60, edges ≤ 90).
5. Final order: topological order of the DAG, choosing among available nodes by smallest x
   (rounded to 1e-6), then smaller p. Teams never shown are marked `unseen` and placed by the same rule.
6. Return `{ order: slug[], unseen: Set, x, acceptedEdges, droppedEdges }`.

Worked example: prior A,B,C,D; pick D>A only → B, D, A, C.

### Trio selection (`trios.ts`)

- 15 rounds by default. After round 15 the user may "Do another" up to round 30.
- Hard: a trio (as a set) never repeats; in rounds 1-15 no team appears more than 3 times
  (rounds 16-30: at most 6); every pool team appears at least once by round 15 when
  pool size ≤ 45 (plan coverage so this cannot become impossible late).
- Rounds 1-8: members within 8 positions of each other in the prior; prefer unseen teams and
  trios containing a committee-vs-FEI disagreement (the interesting decisions).
- Rounds 9+: adaptive — score candidate trios by information on pairs still undecided by the
  transitive closure of the user's accepted edges, weighted by BT closeness p(1−p) and closeness in
  the current ranking; coverage still enforced.
- Deterministic given (pool, prior, picks, seed). Expose `nextTrio(state, rng)` and
  `isValidRun(rounds)`.

### Share code (`sharecode.ts`)

Binary, base64url without padding: `[version=1][season−2000][week][nRounds]` then per round 3
team indices in the user's order (1st, 2nd, 3rd), where index = position in the sorted list of
ALL FBS slugs in that week's file (fits a byte), then a CRC-16/CCITT of everything before.
15 rounds ≈ 68 chars. `decode` returns a typed error (bad base64, version, checksum, length,
index out of range, duplicate team in a trio, week not found) — never throws to the UI.
Round-trip test on 1,000 random runs.

### Playoff (`playoff.ts`)

Input: user's ordered list (pool order, extended with non-pool conference leaders appended in
GWD order so 5 champions always exist), week file. Champions: `week.champions[conf]` if set,
else stand-in = best conference win pct (from confRecord), tie → higher in the given order,
then better GWD. Auto bids = the `conferenceChampions` highest-ranked champions + guaranteed
teams within their threshold. Fill at-large by order to `size`. Seeds: straight by order among
the field. Byes = top `byes` seeds. First round pairs (5v12, 6v11, 7v10, 8v9 for 12/4); QF:
1 vs 8/9 winner, 2 vs 7/10, 3 vs 6/11, 4 vs 5/12. Also return first five out.

### Agreement (`agreement.ts`)

- Round match: the user's trio order is consistent with the reference on every pair the
  reference orders (committee: pairs with both teams unranked are ignored; FEI: GWD order).
- Pairwise: of all pairwise calls the user made, share matching committee (pairs it orders) and
  FEI. Copy: "Of your 45 head-to-head calls, 32 matched the committee (71%) and 38 matched FEI (84%)."

## Site map (owner: content)

| URL | Page |
| --- | --- |
| `/` | Home: H1 + one indexable paragraph above the fold, the game island, then current top 12 (independent vs committee) as static HTML below |
| `/rankings` | FEI GWD top 25 beside committee top 25 with deltas (current week) |
| `/rankings/{season}/week-{N}` | Frozen weekly copy; canonical to itself |
| `/teams/{slug}` | Team resume page: header with four ranks + committee rank, un-blinded card, game log table with tiers, resume strip, rank history by week (from all week files), "committee vs FEI" callout, links to 3 nearest compares |
| `/compare/{a}-vs-{b}` | Every pair in the committee top 25 (300). Slug order: better committee rank first. Two cards side by side, head-to-head note, who FEI and the committee prefer |
| `/bubble` | Committee 8-20 sorted by GWD rank, gap highlighted |
| `/r/{code}` | Shared result (island renders from code; Pages Function injects per-code title/OG tags) |
| `/how-it-works` | Glossary: GWD, ELS, OFEI, DFEI, tiers, ranking method, playoff format |
| `/about` | Who/why, the independence statement (the ONLY place "ESPN", "FPI", "SP+", "Game Control" may appear), attribution, contact |
| `/privacy` | Plain-language privacy page |
| `/404` | Not found |

SEO: unique `<title>` and meta description per page templated from data; canonical URL
(absolute, no trailing slash); Open Graph + Twitter tags; schema.org JSON-LD (`WebApplication`
on home, `ItemList` on rankings/archive/bubble, `SportsTeam` on team pages, `ItemList` of two
`SportsTeam` on compare, `WebPage`/`AboutPage` elsewhere); `sitemap.xml` generated at build with
lastmod = the week's `asOf` (archive pages: their own week's asOf; static pages: latest asOf);
`robots.txt` allowing all with sitemap URL. Every team name anywhere links to its team page.
OG images: one per team (1200×630 PNG generated at build with @resvg/resvg-js into
`public/og/teams/` or emitted via an endpoint), plus a default site image.

## Design (game dark; content pages light + dark via prefers-color-scheme)

- Palette tokens in `src/styles/tokens.css`: bg `#0E0F12`, surface one step lighter (`#16181D`),
  raised `#1E2128`, text off-white `#ECEDEE`, muted `#9BA1AB`, accent electric green-gold
  (e.g. `#C8F135`, adjust for contrast), win green, loss red, tier ramp gold (5★) → grey (0.5★).
  Light theme tokens for content pages. All text ≥ 4.5:1 contrast (Lighthouse a11y = 100).
- Type: Barlow Condensed (self-hosted via @fontsource, 600/700 only, `font-display: swap`,
  preload the one used above the fold) for records, ranks, team names in caps; system UI sans for
  body. Numbers `font-variant-numeric: tabular-nums`.
- Team identity block: color block in primary, name in condensed caps, 4px secondary rule;
  text color on the block chosen by contrast at build/render.
- Motion < 300ms, respects `prefers-reduced-motion`.
- Content pages are typographic: tables, not cards.

## Game (owner: game) — `/` and `/r/{code}`

- Intro panel (our own words) explaining: three resumes, no names; rank them; your picks move
  teams from the committee's ranking; compare with the committee, FEI and fans. "Play".
- Progress: "Round 3 of 15", skip-to-results enabled after round 5 (marks result partial).
- Card: letter + record; bars for Strength of Record (GWD), Offense (OFEI) and Defense (DFEI)
  side by side, Strength of Schedule (ELS); rank number "#N" beside each bar; a tap/click on a
  metric name shows a one-line definition; resume strip (dot per game, size by tier, green W /
  red L, chronological); quality-win counts; game log toughest first: stars, tier label, site,
  result with margin ("W +16"). Head-to-head flag above the cards when trio teams played
  ("B beat A head-to-head · +16"; multiple flags when all three played).
- Ranking: "Rank 1st" on each card; after the first pick that card shows "1st" and the other two
  show "Rank 2nd"; the third is implied. Undo before the round locks.
- Reveal modal after each round (skippable via settings): teams in the user's order, name,
  record, color block; under each: You / Committee / FEI / Fans (Fans hidden until data exists);
  running line "You've matched the committee in 4 of 6 rounds, FEI in 5 of 6." Tap anywhere or
  press a key to continue. Focus-trapped, Esc closes, announced to screen readers.
- After round 15: "15 rankings in" panel — "Do another" (up to 30) or "Final results".
- Results: tabs Your ranking / Committee / FEI / Fans (when ≥ threshold); the selected list as
  a 5×5 grid of numbered team tiles (color block + condensed name, no logos; single column list
  on phones) with a "First 5 out" column (26-30); two toggles: "Compare with committee" (each
  tile shows the committee rank and an up/down delta) and "Highlight playoff field" (the 12 teams
  in the bracket are outlined). Unseen teams marked. Below: 12-team bracket (first round 5v12,
  6v11, 7v10, 8v9; quarterfinals vs seeds 1-4 with byes; semifinal slots), automatic bids and
  at-large lists; agreement sentence; share (copy link, Web Share API, image); play again.
  One ad slot between the top 25 and the share module (when ads on).
- Mobile (390px): cards in a horizontal snap-scroll row at 88% width with a sticky footer holding
  the rank button for the card in view, plus dots showing which card is in view. One-thumb.
- Data: fetches `/game-data/{season}-{week}.json` (current week for `/`, the code's week for /r/).
  Initial HTML (SSR) shows the intro panel so LCP does not wait on the fetch.
- State in Zustand; no ad script runs before the game is interactive.
- Votes: after each round POST `/api/vote` (fire-and-forget). Analytics events via
  `navigator.sendBeacon('/api/event', ...)`: round_completed {round}, run_completed,
  results_shared {channel}, skip_to_results, reveal_disabled, do_another.

## Backend (owner: backend) — Cloudflare Pages Functions + D1

Pages Functions in `/functions` (same origin as the site; no separate Worker, no routes, works
on pages.dev previews). Binding `DB` (D1). `wrangler.toml` with `pages_build_output_dir = "dist"`.

- `POST /api/vote` `{season, week, order:[a,b,c]}` → validates slugs against that week's
  game-data (fetched via `env.ASSETS`), rate limit 30/hour per salted-hash IP (salt rotates daily,
  from env `IP_SALT`), stores one row (no IP). Deletes rate-limit rows older than 24h on write.
- `GET /api/fans?season=&week=&trio=a,b,c` → consensus order for the trio from pairwise vote
  counts that week; `null` unless every pair has ≥ 20 votes. Cache 60s.
- `GET /api/fans/top25?season=&week=` → BT ranking over all pairwise votes that week, `null`
  under a threshold (e.g. 200 votes). Cache 300s.
- `POST /api/event` → increments `(day, name, prop)` counter; no IP, no IDs.
- `GET /og/r/{code}.png` → 1200×630 PNG of the user's top 12 computed from the code alone
  (no DB), via resvg-wasm with an embedded font; long cache headers; invalid code → default image.
- `GET /r/{code}` → serves the static results shell with per-code `<title>`, description,
  `og:image`, canonical, via HTMLRewriter; invalid code still serves the shell (UI shows error).

## Ads

`PUBLIC_ADS=on|off` (default off). `<AdSlot kind="leaderboard|incontent|sidebar">` renders a
labeled ("Advertisement") container with reserved min-height so CLS = 0, or nothing when off.
Network loader is a stub that runs only after first interaction or 3s, whichever first, and only
when `PUBLIC_AD_NETWORK` is set. Slot plan: home 1 (below game), results 1, team/compare/
rankings/bubble 2 (in-content after first block + desktop sticky sidebar that becomes in-content
on mobile), how-it-works/about 1.

## Environment variables

`CFBD_API_KEY` (pipeline), `PUBLIC_ADS`, `PUBLIC_AD_NETWORK`, `IP_SALT` (Functions secret),
`CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` (deploy). Document all in README.

## Deviations from the plan (keep README in sync)

1. Astro 7 (current) instead of Astro 5.
2. Pages Functions instead of a separate Worker + routes: same origin, works on previews, one deploy.
3. Ranking = committee-prior + ranked pairs + isotonic projection, not raw Bradley-Terry
   (raw BT cannot guarantee criterion 7). BT is still used for adaptive selection and fans.
4. "Not enough data" → every pool team is guaranteed an appearance in 15 rounds; only skipped
   runs show unseen teams.
5. FBS count is data-driven (138 in 2026).
6. Fans consensus uses pairwise counts (≥ 20 per pair) rather than exact-trio counts, which would
   almost never reach 20.
7. Event analytics stored in D1 by our own endpoint instead of Plausible (free, cookie-free, first-party).
8. "Do another" rounds after 15 (up to 30) and a full 12-team bracket on results.
9. Automatic bids: the five highest-ranked conference champions plus Notre Dame if ranked in the top 12 (2026 format), from data config.
