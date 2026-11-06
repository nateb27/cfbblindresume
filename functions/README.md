# Backend: Cloudflare Pages Functions + D1

Same origin as the static site (no separate Worker, no routes), so it works on `*.pages.dev`
previews too. Each route file under `functions/` is a thin wrapper; the logic lives in
`functions/_lib/` and is unit-tested in `tests/functions/` (part of `npm test`).

| Route | File | What it does |
| --- | --- | --- |
| `POST /api/vote` | `api/vote.ts` | Stores one ranked trio. 204 / 400 / 405 / 413 / 415 / 429 / 503 |
| `GET /api/fans?season=&week=&trio=a,b,c` | `api/fans.ts` | Fans' consensus order for a trio, or `null` until every pair has 20 votes. Cached 60 s |
| `GET /api/fans/top25?season=&week=` | `api/fans/top25.ts` | Fans' top 25 (Bradley-Terry over all pairwise votes), `null` under 200 votes. Cached 300 s |
| `POST /api/event` | `api/event.ts` | Increments an allowlisted `(day, name, prop)` counter. 204 / 400 |
| `GET /r/{code}` | `r/[code].ts` | The static `/r` shell with per-code `<title>`, description, canonical, Open Graph and Twitter tags |
| `GET /og/r/{code}.png` | `og/r/[code].ts` | 1200x630 share image of the run's top 12, rendered from the code alone (no database) |

## Endpoints

### `POST /api/vote`

Body (JSON; `application/json` or `text/plain`, at most 2 KB):

```json
{ "season": 2026, "week": 9, "order": ["miami", "georgia", "utah"] }
```

`order` is the user's ranking of one round: 1st, 2nd, 3rd. Checks, in order:

1. The shape: integer season and week, three distinct slugs. Otherwise 400.
2. The week's game data (`/game-data/{season}-{week}.json`, read through `env.ASSETS` and
   cached per isolate) exists and all three slugs are in its pool. Otherwise 400.
3. Rate limit: at most 30 votes per rolling hour per client. Otherwise 429 with `Retry-After`.
   Refused votes are not counted.
4. One D1 batch (a single transaction) counts the request, inserts the vote, bumps the three
   pairwise counters (1st>2nd, 1st>3rd, 2nd>3rd) and bumps the week's total. Then 204.

Errors are `{ "error": "..." }` with `Cache-Control: no-store`. The game posts votes
fire-and-forget, so nothing here blocks the UI.

### `GET /api/fans?season=2026&week=9&trio=a,b,c`

```json
{ "season": 2026, "week": 9, "trio": ["a", "b", "c"], "threshold": 20, "minPairVotes": 23,
  "consensus": ["b", "a", "c"], "counts": { "a>b": 9, "b>a": 14, "...": 0 } }
```

- `consensus` is `null` unless every pair of the trio has at least 20 votes (both directions
  summed). This is SPEC deviation 6: counting exact trios would almost never reach 20.
- The order is by pairwise majorities (Copeland). A three-way cycle or a tie falls back to each
  team's summed vote share, then slug order.
- `trio` comes back sorted. The response is the same for any order of the same three teams, and
  the cache key is normalized the same way.
- `Cache-Control: public, max-age=60`, plus the Cache API on custom domains.

### `GET /api/fans/top25?season=2026&week=9`

```json
{ "season": 2026, "week": 9, "votes": 1234, "threshold": 200, "top25": ["miami", "..."] }
```

`top25` is `null` under 200 votes in the week. Otherwise it is the 25 strongest teams from a MAP
Bradley-Terry fit (`src/lib/bradley-terry.ts`) over every pairwise counter of the week. The fit
uses a Gaussian prior, so a team that won every comparison still gets a finite strength. Cached
300 s.

### `POST /api/event`

The island sends this with `navigator.sendBeacon('/api/event', JSON.stringify(...))`, so the body
arrives as `text/plain`:

```json
{ "name": "round_completed", "prop": "3", "props": { "round": 3 } }
```

Only these events and values are counted:

| Event | Allowed `prop` |
| --- | --- |
| `round_completed` | 1-30 |
| `run_completed` | 1-30 |
| `skip_to_results` | 1-30 |
| `do_another` | 1-30 |
| `results_shared` | `copy`, `webshare`, `image` |
| `reveal_disabled` | none |

Anything else gets a 400. The endpoint stores no IP and no id, only `n` per
`(UTC day, name, prop)`.

### `GET /r/{code}`

The handler fetches the static shell `/r` (`src/pages/r.astro`) through `env.ASSETS` and decodes
the code the same way the island does: `parseShareCode`, then the code's week from `env.ASSETS`,
`resolveShareCode`, `gameRunViolations` and `computeRunResults`. `HTMLRewriter` then rewrites:

- `<title>`: "My blind-resume top 25: Alabama, Miami, Georgia lead | CFB Blind Resume"
- `meta description` and `og:description`: rounds played (marked as a partial run when short),
  the week, the first-round byes, and an invitation to compare and play.
- `link rel=canonical` and `og:url`: `{site origin}/r/{code}`. The site origin is read from the
  shell's own canonical, which comes from Astro `site`.
- `og:image` and `twitter:image`: `{request origin}/og/r/{code}.png`, so preview deployments
  show their own image.
- `og:image:alt` and `twitter:image:alt`: the top 12 written out.

`noindex` is kept. An invalid code still gets the shell, with its generic tags and a 200, and the
island shows the error. Headers are `Cache-Control: public, max-age=0, must-revalidate`, the same
as Pages' own HTML, because the shell references this deploy's hashed assets.

### `GET /og/r/{code}.png`

The share image is computed from the code and the week's game data only. It shows the run's top
12 as lower-third rows: seed plate (accent for the first-round byes), team color block, condensed
caps name and record, and secondary rule. Layout is DESIGN.md §16, and the reference render
matches.

- **Valid code:** `image/png`, `Cache-Control: public, max-age=604800, immutable`. The Cache API
  key is `code + render version + the week asset's ETag`, so each code renders once per colo and
  new data renders anew.
- **Invalid code** (bad base64 or checksum, unknown week, rule violation): `/og/default.png` from
  `env.ASSETS` (the content site's default image), with a 1 h cache. If that asset is missing,
  the function renders a generic brand card instead.
- `X-Share-Image: ranking | default` tells the two cases apart.

## The share-image renderer (free plan: 10 ms CPU, 3 MiB bundle)

satori and resvg are far too slow and heavy for a Worker, so the image is built from rectangles
and pre-rasterized glyphs.

- **`scripts/fn-build-atlas.mjs`** (`npm run fn:atlas`, output committed):
  - Rasterizes Barlow Condensed 600/700 from `src/assets/fonts/*.ttf`. Outlines and GPOS kerning
    come from opentype.js; anti-aliasing comes from @resvg/resvg-js, the same rasterizer as the
    build-time team OG images.
  - Covers exactly the strikes DESIGN.md §16 needs: 700 at 76/40/34-26 and 600 at 30/28/26.
  - Small sizes are rendered at 4 horizontal sub-pixel phases, so letter spacing stays even.
  - Masks are run-length encoded: interiors become native `fill()` calls and only edge pixels
    are blended. This keeps the first, un-JITted request fast.
  - Output is `functions/_lib/atlas.bin` (393 KiB of masks, imported as a wrangler Data module)
    plus `atlas.json` (metrics).
- **Request time** (`_lib/share-image.ts`, `_lib/raster.ts`, `_lib/png.ts`):
  - Layout uses advance widths, kerning and tracking from the atlas, then glyphs are composited
    into an 8-bit palette canvas.
  - Coverage is quantized so that every blend fits in 256 colors (249 used, 16 levels).
  - Rows identical to the row above become PNG "Up" rows of zeros.
  - The PNG is deflated with native `CompressionStream('deflate')`, so no JS deflate runs.
- **Output:** about 23.5 KiB per PNG, byte-identical across runs. All 138 FBS names fit at 34 px.
  The renderer shrinks to 26 px and then falls back to the short name if a future name needs it.

### Measured CPU

From `npm run fn:bench`, Node 22, the same V8 as workerd. The numbers cover one request after the
asset fetch:

| Phase | Warm, median | Warm, p90 |
| --- | --- | --- |
| Decode + `computeRunResults` | 0.6 ms | 1.0 ms |
| Paint | 0.7 ms | 0.9 ms |
| Deflate + CRC | 3.6 ms | 4.3 ms |
| **Total** | **5.0 ms** | **6.0 ms** |

- **Cold** (the first request in a brand-new process, nothing JIT-compiled): about 12.8 ms
  median, 16.9 ms worst of 7. That breaks down as results 2.5, paint 4.8 and deflate 5.6 ms.
- **Atlas indexing:** about 1.3 ms, once per isolate.
- **What this means for production:** the warm path is well under the 8 ms target. Only the very
  first image in a new isolate can exceed 10 ms. Several things keep that rare:
  - Crawlers fetch `/r/{code}` first, which warms the same `src/lib` code.
  - Each code renders once per colo (Cache API).
  - An invalid code never renders at all.
- **If you see errors:** 1102 errors ("exceeded resource limits") on `/og/r/*` in
  `wrangler pages deployment tail` mean those cold renders are failing. The fix is the Workers
  Paid plan ($5/month, 30 s CPU). That is the owner's decision; nothing in the code changes.

### Bundle size

`npx wrangler pages functions build --outdir <dir>`: `index.js` is 172 KB and `atlas.bin` is
402 KB, about **160 KB gzipped together**, roughly 5% of the 3 MiB free-plan limit.

## D1

Schema: `migrations/0001_init.sql`.

| Table | Contents |
| --- | --- |
| `votes` | `season, week, a, b, c` (the user's order), `created_day` (UTC date, no time) |
| `pair_counts` | `(season, week, winner, loser) -> n`, maintained on insert so the fans endpoints read only a few rows |
| `vote_totals` | `(season, week) -> n` |
| `rate_limit` | `(hash, window_start) -> count`; rows older than 24 h are deleted on every vote |
| `events` | `(day, name, prop) -> n` |

### Privacy (house rule 6)

- No IP address, user id, cookie or timestamp finer than a day is stored.
- The rate-limit key is `SHA-256(IP_SALT | UTC day | IP)`. Mixing in the date rotates the salt
  daily, and keys from different days cannot be linked.
- If `IP_SALT` is missing, the function uses a random per-isolate salt rather than an unsalted
  hash. Rate limiting is then weaker, since it only holds within one isolate, but privacy is not.

### First-time setup (production)

```sh
npx wrangler login                       # or CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID in the env
npx wrangler d1 create cfbblindresume    # copy the printed database_id into wrangler.toml
npx wrangler d1 migrations apply cfbblindresume --remote
npx wrangler pages project create cfbblindresume --production-branch main   # if the project does not exist
openssl rand -hex 32 | npx wrangler pages secret put IP_SALT --project-name cfbblindresume
```

- **Databases:** production uses `cfbblindresume`; every preview deployment (any branch other than
  `main`, e.g. `staging`) uses `cfbblindresume-preview` via `[env.preview]`, so test votes never
  reach the production fan consensus. Both ids are in `wrangler.toml`.
- **Preview secrets:** add `IP_SALT` with `--env preview` as well.
- **Migrations:** apply them to both databases before deploying code that needs them:
  `npx wrangler d1 migrations apply cfbblindresume --remote` and
  `npx wrangler d1 migrations apply cfbblindresume-preview --remote --env preview`.

### Deploy

```sh
npm run build                                   # Astro -> dist/ (also emits /game-data/*.json and /og/default.png)
npx wrangler pages deploy                       # uses pages_build_output_dir = "dist" and compiles functions/
```

Git-connected Pages builds work the same way: build command `npm run build`, output `dist`. The
Functions and `wrangler.toml` are picked up automatically.

## Local development

```sh
echo 'IP_SALT=dev-only-salt-change-me' > .dev.vars          # gitignored
npx wrangler d1 migrations apply cfbblindresume --local
npx astro build --outDir /tmp/site && npx wrangler pages dev /tmp/site --port 8788
```

- `npm run fn:integration` does all of this in a scratch directory (`--skip-build` reuses the
  last build, `--keep` leaves the server running). It exercises every endpoint on workerd: 41
  checks covering votes, 400/405/429, fans thresholds and caching, top 25, events, `/r/{code}`
  tags, share images and default images, and "no IP in D1". It saves a sample share image and
  writes a JSON summary.
- `npm run fn:bench`: CPU benchmark for the share image.
- `npm run fn:atlas`: rebuild the glyph atlas after changing the fonts, the sizes or the
  character sets. `node scripts/fn-build-atlas.mjs --check` verifies the committed copy.
  - It is deliberately not wired into `prebuild`. The committed output only changes with the
    fonts, and deploy builds should not depend on a native rasterizer.
  - `tests/functions/share-image.test.ts` checks the committed atlas against its manifest and
    checks that every school name in `data/` is drawable.

## Environment

| Name | Kind | Used by |
| --- | --- | --- |
| `DB` | D1 binding (`wrangler.toml`) | votes, fans, events |
| `IP_SALT` | secret (`wrangler pages secret put`, `.dev.vars` locally) | rate-limit hashing |
| `PUBLIC_ADS` | var (`wrangler.toml`, default `off`) | read by the Astro build, not by the Functions |
| `ASSETS` | provided by Pages | game data, the `/r` shell, `/og/default.png` |
