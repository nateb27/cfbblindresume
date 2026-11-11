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
2. **No logos, no ESPN-hosted images.** Team identity = school name + a color block or tab in
   the team's primary color + a rule in its secondary color (DESIGN.md: covers and index tabs).
   Never load `logos` URLs from CFBD.
3. **Do not copy ESPN's visual design.** Structure (three blind cards, rank, reveal, results with
   bracket) is shared; the look is ours: no red slanted badges, no sunburst/ray backgrounds, no
   "?" badge in a red square, no dashed card borders, no Graduate/Rye/Oswald fonts, no red
   accent. Our palette and type are below and in DESIGN.md.
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

### Playoff formats, stored in the week file (UX priority: users want both)

The week file carries `playoffFormats: PlayoffFormat[]` (replaces the single `playoff`; schemaVersion 2).
Exactly one has `default: true`. Formats come from `pipeline/playoff_formats.json` (the one place they
live). The results page and content pages show the default (12-team, current) and offer a one-tap
toggle to the other (24-team, proposed). Copy always labels the proposed format "Proposed for 2027 —
not final".

| id | status | size | byes | auto bids | guaranteed | note |
| --- | --- | --- | --- | --- | --- | --- |
| `12-team` | current, default | 12 | 4 | 5 highest-ranked conference champions (`{from:'all', count:5}`) | Notre Dame if ranked ≤ 12 | 2026 format |
| `24-team` | proposed | 24 | 8 | the 4 Power 4 champions (`{from:'power', count:4}`) + the highest-ranked champion of the other conferences (`{from:'nonPower', count:1}`) | none | 19 at-large; source: Deseret News, Oct 15 2026 (https://www.deseret.com/sports/2026/10/15/college-football-playoff-reportedly-expanding-24-teams/) — never link ESPN |

`powerConferences: ['ACC','Big 12','Big Ten','SEC']`, `nonConferences: ['FBS Independents']`.
Seeding is straight by the given order. Brackets use the standard seeded bracket for the next power
of two (validator: `byes == nextPow2(size) - size`): 12 → 16-slot bracket (5v12, 6v11, 7v10, 8v9;
1 vs 8/9 winner, 4 vs 5/12, 2 vs 7/10, 3 vs 6/11); 24 → 32-slot bracket (first round 16v17, 9v24,
13v20, 12v21, 15v18, 10v23, 14v19, 11v22; second round 1 vs 16/17, 8 vs 9/24, 4 vs 13/20,
5 vs 12/21, 2 vs 15/18, 7 vs 10/23, 3 vs 14/19, 6 vs 11/22). Ordering longer than the pool:
extend the user's order with non-pool teams in GWD order (champion candidates guaranteed
present) so a 24 field + first five out always exists.

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

Remaining schedule (additive, schemaVersion still 2): each team may carry `upcoming` (games after
week N not yet played: week, date, opponent, site, conference flag; no score). `upcomingRows`
in `data.ts` adds the opponent's current tier and committee rank. A missing list means unknown.

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

- 15 rounds by default. After round 15 the user may play "One more round" up to round 30.
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
Future versions keep byte 0 = version and the trailing CRC, so `version` is reported only for a
version byte 2..15 with an intact CRC; garbled or mistyped codes read as damaged.
Round-trip test on 1,000 random runs.

### Playoff (`playoff.ts`) — generalized to any PlayoffFormat (see Playoff formats)

Input: any ordered list of teams (the user's ranking, the committee, FEI or fans) and the week
(`playoffContext(week)` carries every format, default first). The order is deduplicated and
extended with the best non-order teams in GWD order to `size + 5`, plus any champion still
missing, so every format's field and first five out always exist. Champions: `week.champions[conf]`
if set, else stand-in = best conference win pct (from confRecord), tie → higher in the given
order, then better GWD. Auto bids: each `autoBids.rules` entry in order takes its `count`
best-ranked champions without a bid from `all`, `power` (conference in `powerConferences`) or
`nonPower` champions; then guaranteed teams ranked at or above their threshold. Fill at-large by
order to `size`. Seeds: straight by order among the field. Bracket: the standard seeded bracket
for `nextPow2(size)` slots, byes = the top `nextPow2(size) - size` seeds (pairings in "Playoff
formats" above). `computePlayoffs(order, ctx)` returns every format keyed by id (default first);
`computePlayoff(order, ctx, id?)` one format (default when omitted). Each result has the format,
champions, auto bids, at-large, field, byes, bracket games and first five out.

### Agreement (`agreement.ts`)

- Round match: the user's trio order is consistent with the reference on every pair the
  reference orders (committee: pairs with both teams unranked are ignored; FEI: GWD order).
- Pairwise: of all pairwise calls the user made, share matching committee (pairs it orders) and
  FEI. Copy: "Of your 45 head-to-head calls, 32 matched the committee (71%) and 38 matched FEI (84%)."

## Site map (owner: content)

| URL | Page |
| --- | --- |
| `/` | Home: H1 + one indexable paragraph above the fold, the game island, then current top 12 (independent vs committee) as static HTML below |
| `/rankings` | FEI GWD top 25 beside committee top 25 with deltas (current week), with "in the 12" / "in the 24 (proposed)" cut lines for both orders and the projected fields |
| `/rankings/{season}/week-{N}` | Frozen weekly copy; canonical to itself |
| `/teams/{slug}` | Team resume page: header with four ranks + committee rank, un-blinded card, game log table with tiers, resume strip, "Still to play" (remaining schedule with opponent tiers, from `upcoming`), rank history by week (from all week files), "committee vs FEI" callout, links to 3 nearest compares |
| `/compare/{a}-vs-{b}` | Every pair in the committee top 25 (300). Slug order: better committee rank first. Two cards side by side, head-to-head note, who FEI and the committee prefer, remaining schedules side by side |
| `/bubble` | Committee 8-20 sorted by GWD rank, gap highlighted; who is in/out of the 12 and of the proposed 24 by committee vs by FEI |
| `/r/{code}` | Shared result (island renders from code; Pages Function injects per-code title/OG tags). The static shell is noindex with canonical = the site root, which a code that cannot be opened keeps |
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

## Design: DOSSIER (every page follows prefers-color-scheme; DESIGN.md is binding)

- A redacted committee file: paper sheets on a grey board (game pages) or the sheet itself
  (content pages), ink type, toner bar charts; dark mode is a photostat negative. Tokens in
  `src/styles/tokens.css` (light-sheet, light-board, dark), mirrored in `src/styles/tokens.ts`.
  One violet stamp ink (`#4B2C92`, dark `#B9A7F1`) means "you" (picks, your numbers, the field you
  turned on, the primary action, focus); one marker bar (`#121317`, dark `#E6E3D8`) hides what the
  fan may not know yet (team names before lock-in) and lifts on reveal. Win green / loss red only
  for W/L. Opponent tiers on a monochrome toner ramp (more ink = better), drawn as five square pips
  and season ticks, with the tier band in text on every row. All text ≥ 4.5:1, graphics ≥ 3:1
  (Lighthouse a11y = 100).
- Type: Archivo 400/600/800 (self-hosted woff2 from @fontsource/archivo, latin, `font-display:
  swap`, all three preloaded, metric-matched fallbacks), sentence case everywhere, no tracking.
  Numbers 800 and `font-variant-numeric: tabular-nums`.
- Team identity: a cover (primary in full, name in the contrast ink, secondary rule) for the
  reveal, team hero and compare cards; an index tab (rank on a team-color tab, name in ink on paper)
  in lists; text color on team colors chosen by contrast at build/render.
- Borders-only depth (no shadows), 2-6px corners, motion < 300ms, respects
  `prefers-reduced-motion` (the reveal bar is then not drawn).
- Content pages are typographic: tables, not cards.

## Game (owner: game) — `/` and `/r/{code}`

- Intro panel (our own words) explaining: three resumes, no names; rank them; your picks move
  teams from the committee's ranking; compare with the committee, FEI and fans. "Play".
- Progress: "Round 3 of 15", "Finish now" (skip to results) enabled after round 5 (marks result partial).
- Card: letter + record; bars for Strength of Record (GWD), Offense (OFEI) and Defense (DFEI)
  side by side, Strength of Schedule (ELS); rank number "#N" beside each bar; a tap/click on a
  metric name shows a one-line definition; resume strip (tick per game, height by tier, green W /
  red L, chronological); quality-win counts; game log toughest first: pips, tier label, site,
  result with margin ("W +16"). Head-to-head flag above the cards when trio teams played
  ("[H2H] B over A by 16"; multiple flags when all three played). Phones (where the at-a-glance
  table lists the ranks) fold the four bars into one compact row so the game log starts higher.
- Ranking: "Rank 1st" on each card; after the first pick that card's button shows the "1st" stamp
  and "Undo" (the card's picked look, not the primary fill) and the other two show "Rank 2nd"; the
  third is implied. Phones move the carousel to the next open card after the first pick. Undo before the round locks. The second pick locks the
  round after a short countdown ("Lock in automatically", a saved setting that can be turned off,
  WCAG 2.2.1); a real mouse move or keyboard focus on Undo stops the countdown. Controls that appear
  under the finger ignore taps for 400 ms (keyboard and screen-reader activation never blocked).
  Every blind card ends with "Ratings: FEI by Brian Fremeau" (linked).
- Reveal modal after each round (skippable via settings): teams in the user's order, name,
  record, color block; under each: You / Committee / FEI / Fans (Fans hidden until data exists);
  one line with this round's verdict per source (check / cross) and the running counts ("You've
  matched the committee in 4 of 6 rounds, FEI in 5 of 6."); the key to the cells shows on the first
  reveal only. Tap, Esc, Enter or a
  letter key continues; arrows, Page, Home/End and Space scroll it; Next round and the FEI credit
  stay pinned to the bottom edge. Focus-trapped, announced to screen readers. Its FEI column is
  labeled "FEI SoR".
- After round 15: the done panel ("Round 15 of 15") — "One more round" (up to 30) or "Final results".
- Results: tabs Your ranking / Committee / FEI / Fans (when ≥ threshold); the selected list as
  a 5×5 grid of numbered team tiles (index tabs: rank on a team-color tab + name, no logos; single column list
  on phones and tablets, below 1024px) with a "Next five" column (26-30); two toggles: "Compare to committee" (each
  tile shows the committee rank and an up/down delta) and "Show playoff field" (an ink dashed cut
  line with scissors under the unbroken run of field teams at the top, as on the rankings tables,
  plus AQ tags on automatic bids; its note says how many field teams are above it when one sits
  lower: "Above the line: 11 of the 12-team field"). A segmented control "12 teams · 2026 format" |
  "24 teams (2027 proposal)" (default 12) switches the bracket, bid lists, cut line and the teams
  just outside;
  the 24 view shows the one-line rules + "Proposed for 2027 — not final" + source link. Unseen teams marked. Below: the bracket for the selected format
  (12: first round 5v12, 6v11, 7v10, 8v9, quarterfinals vs byes 1-4; 24: first round 9-24, byes 1-8),
  readable on a phone (horizontal scroll by round or stacked rounds), automatic bids and
  at-large lists; agreement sentence; share (copy link, Web Share API, image); play again.
  A headline stat under the title ("Matched the committee on 43% of your head-to-head calls"), a
  key for the marks right under the controls (cut line, AQ, triangles, Unseen / Not shown) and AQ
  tags on automatic bids. One ad slot just above the share module (when ads on). Below 360px the
  format segments read "12 · 2026 format" | "24 (2027 proposal)"; phone bracket tabs read Rd 1 · Rd
  2 · QF · SF · Final.
- Mobile (390px): cards in a horizontal snap-scroll row at 88% width with a sticky footer holding
  the rank button for the card in view, plus dots showing which card is in view. One-thumb, two
  deliberate taps: "Rank B 1st" for the card in view, then two buttons "Rank A 2nd" / "Rank C 2nd"
  (Undo stays on the left; the footer is a fixed 68px in every state). A compact at-a-glance table
  above the cards compares the three teams (record, SoR, Off, Def, Sched, vs top 25).
- Data: fetches `/game-data/{season}-{week}.json` (current week for `/`, the code's week for /r/).
  Initial HTML (SSR) shows the intro panel so LCP does not wait on the fetch.
- State in Zustand; no ad script runs before the game is interactive.
- Votes: after each round POST `/api/vote` (fire-and-forget). A 404 stops votes for the page view;
  a dropped vote (`202` + `X-Vote-Dropped`, or a `429`) pauses them until `Retry-After`.
  Analytics events via `navigator.sendBeacon('/api/event', ...)`: round_completed {round} at
  milestone rounds only (1, 5, 10, 15, 20, 25, 30), run_completed, results_shared {channel},
  skip_to_results, reveal_disabled, do_another.
- Fans: one `GET /api/fans/top25` per week per 5 minutes gives the week's vote count and the fans'
  order; per-trio `GET /api/fans` is skipped while the week has fewer than 20 votes (no pair can
  reach the threshold).

## Backend (owner: backend) — Cloudflare Pages Functions + D1

Pages Functions in `/functions` (same origin as the site; no separate Worker, no routes, works
on pages.dev previews). Binding `DB` (D1). `wrangler.toml` with `pages_build_output_dir = "dist"`.

- `POST /api/vote` `{season, week, order:[a,b,c]}` (`application/json` only; a browser request
  must be same-origin by `Sec-Fetch-Site`/`Origin`, else 403) → validates slugs against that week's
  game-data (fetched via `env.ASSETS`), rate limit 120/rolling hour per client (full IPv4 address
  or IPv6 /64), keyed by a salted hash (salt rotates daily, from env `IP_SALT`; each hourly window
  is keyed under its own UTC day so the limit carries over midnight). The count and the vote are
  one D1 batch (atomic under concurrency). Over the limit the vote is dropped with `202` +
  `Retry-After` + `X-Vote-Dropped: rate-limit` (no browser console error). Stores one row (no IP)
  plus three pairwise counters. Rate-limit rows are deleted 24h after their window starts (on
  vote and event writes, and by a daily GitHub Action).
- `GET /api/fans?season=&week=&trio=a,b,c` → consensus order for the trio from pairwise vote
  counts that week; `null` unless every pair has ≥ 20 votes. Cache 60s.
- `GET /api/fans/top25?season=&week=` → `{votes, threshold, top25, order}`: BT ranking over all
  pairwise votes that week (`order` = every voted team, so results can show the fans' next five;
  `top25` its first 25), both `null` under 200 votes; `votes` always present. Cache 300s.
- `POST /api/event` → increments `(day, name, prop)` counter; no IP, no IDs. Same-origin only;
  past 100 events per client per 10 minutes (per isolate) events are dropped silently.
- `GET /og/r/{code}.png` → 1200×630 PNG of the user's top 12 computed from the code alone
  (no DB), with a one-line hook ("Matched the committee on 43% · Biggest call: Kentucky ▲4");
  long cache headers + Cache API so each code renders once; invalid code → default image.
  HARD CONSTRAINT: Cloudflare Workers/Pages Functions FREE plan = 10 ms CPU per request and 3 MiB
  compressed bundle. satori/resvg are likely too slow/heavy. Design for it (e.g. build-time glyph
  atlas of the site font + palette PNG + native deflate) and measure render CPU in
  Node (target < 8 ms) — report the number. If it truly cannot fit, report and propose the
  Workers Paid plan ($5/mo) as the human's decision; keep the default-image fallback working.
- `GET /r/{code}` → serves the static results shell with per-code `<title>`, description,
  `og:image`, canonical, via HTMLRewriter; invalid code still serves the shell with 200 (UI shows
  error; a 404 document would log a console error) with canonical and og:url pointing at `/`.
  API and image responses carry `X-Robots-Tag: noindex`; pages get anti-framing headers.

## Working in parallel (build-time rules for agents)

Several agents share this checkout. Never run a bare `npm run build` / `astro build` into `dist/`
except in the final integration step: build with `npx astro build --outDir <scratch>/<area>-dist`.
Dev servers: content 4321, game 4322, backend 8788 (`wrangler pages dev <dir> --port 8788`).
Lighthouse: `CHROME_PATH=/opt/pw-browsers/chromium npx lighthouse <url> --chrome-flags="--headless=new --no-sandbox" --form-factor=mobile`.
Playwright: `require('playwright')` works from any directory; `chromium.launch()` needs no options.

## Ads

`PUBLIC_ADS=on|off` (default off). `<AdSlot kind="leaderboard|incontent|sidebar">` renders a
labeled ("Advertisement") container with reserved min-height so CLS = 0, or nothing when off.
Network loader is a stub that runs only after first interaction or 3s, whichever first, and only
when `PUBLIC_AD_NETWORK` is set. Slot plan: home 1 (below game), results 1, team/compare/
rankings/bubble 2 (in-content after first block + desktop sticky sidebar that becomes in-content
on mobile), how-it-works/about 1.

## Environment variables

`CFBD_API_KEY` (pipeline), `PUBLIC_ADS`, `PUBLIC_AD_NETWORK`, `IP_SALT` (Functions secret),
`CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` (deploy from a shell, and the daily rate-limit
purge Action). Document all in README.

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
8. "One more round" after 15 (up to 30) and full brackets on results: the 12-team 2026
   format by default and the proposed 24-team format behind a toggle.
9. Automatic bids: the five highest-ranked conference champions plus Notre Dame if ranked in the top 12 (2026 format), from data config.
10. Ratings come from FEI by Brian Fremeau (bcftoys.com) plus raw scores (CollegeFootballData.com);
    no ESPN-produced metric is used anywhere.
