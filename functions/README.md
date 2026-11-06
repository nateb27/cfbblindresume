# Backend: Cloudflare Pages Functions + D1

Same origin as the static site (no separate Worker, no routes), so it works on `*.pages.dev`
previews too. Each route file under `functions/` is a thin wrapper; the logic lives in
`functions/_lib/` and is unit-tested in `tests/functions/` (part of `npm test`).

| Route | File | What it does |
| --- | --- | --- |
| `POST /api/vote` | `api/vote.ts` | Stores one ranked trio. 204 (stored) / 202 (dropped by the rate limit) / 400 / 403 / 405 / 413 / 415 / 503 |
| `GET /api/fans?season=&week=&trio=a,b,c` | `api/fans.ts` | Fans' consensus order for a trio, or `null` until every pair has 20 votes. Cached 60 s |
| `GET /api/fans/top25?season=&week=` | `api/fans/top25.ts` | Week's vote count + fans' order (Bradley-Terry over all pairwise votes; `top25` and the full `order`), `null` under 200 votes. Cached 300 s |
| `POST /api/event` | `api/event.ts` | Increments an allowlisted `(day, name, prop)` counter. 204 / 400 / 403 |
| `GET /r/{code}` | `r/[code].ts` | The static `/r` shell with per-code `<title>`, description, canonical, Open Graph and Twitter tags |
| `GET /og/r/{code}.png` | `og/r/[code].ts` | 1200x630 share image of the run's top 12, rendered from the code alone (no database) |

## Endpoints

### `POST /api/vote`

Body (`Content-Type: application/json` only, at most 2 KB; the cap is enforced while streaming, so
a chunked body is never buffered past it):

```json
{ "season": 2026, "week": 9, "order": ["miami", "georgia", "utah"] }
```

`order` is the user's ranking of one round: 1st, 2nd, 3rd. Checks, in order:

1. Same origin: a request that carries `Sec-Fetch-Site` must say `same-origin`, and one that
   carries `Origin` must match the request's own origin. Otherwise 403. Browsers send these on
   every cross-site POST (including `no-cors` fetches and beacons), so another website cannot cast
   votes from its visitors' browsers. Requests with neither header (curl, scripts) fall to the rate
   limit. JSON-only also means a cross-site JSON POST needs a CORS preflight, and `OPTIONS` gets 405.
2. The shape: integer season and week, three distinct slugs. Otherwise 400 (wrong content type
   415, body over 2 KB 413).
3. The week's game data (`/game-data/{season}-{week}.json`, read through `env.ASSETS` and
   cached per isolate) exists and all three slugs are in its pool. Otherwise 400.
4. One D1 batch (a single serialized transaction): purge rate-limit rows older than 24 hours,
   count this attempt for the client, then insert the vote and bump the three pairwise counters
   (1st>2nd, 1st>3rd, 2nd>3rd) only if the client is within the limit, and read the counts back.
   Because the guard reads the count inside the same transaction, concurrent requests cannot all
   see a stale count (160 parallel votes from one IP store exactly 120).
5. Within the limit: 204. Over it: the vote is not stored and the answer is
   `202 { "dropped": "rate-limit", "retryAfter": N }` with `Retry-After: N` and
   `X-Vote-Dropped: rate-limit`. It is a 2xx on purpose, because a 429 makes Chrome log a console
   error on every round for players on a shared IP; the island pauses votes on it.

**Rate limit:** 120 votes per rolling hour per client (four 30-round runs or eight standard runs),
where a client is a full IPv4 address or an IPv6 /64 (one home line or server owns a whole /64 and
could rotate the rest). Fixed hourly windows with the sliding-window approximation; each window's
key is hashed with that window's own UTC day, so the limit carries across midnight while keys from
different days stay unlinkable. Refused attempts are counted too, so a client that keeps sending
while refused stays refused.

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
{ "season": 2026, "week": 9, "votes": 1234, "threshold": 200, "top25": ["miami", "..."], "order": ["miami", "...", "(every voted team)"] }
```

`top25` and `order` are `null` under 200 votes in the week. Otherwise `order` is every team that
appeared in a vote (the pool, about 30-35 teams), strongest first, from a MAP Bradley-Terry fit
(`src/lib/bradley-terry.ts`) over every pairwise counter of the week, and `top25` is its first 25;
the results page uses `order` for the fans' next five. The fit uses a Gaussian prior, so a team that
won every comparison still gets a finite strength. `votes` is always present: the island fetches
this once per week (reused for 5 minutes) and skips per-trio `/api/fans` requests while `votes` is
under 20, since no pair can reach that threshold. Cached 300 s.

### `POST /api/event`

The island sends this with `navigator.sendBeacon('/api/event', JSON.stringify(...))`, so the body
arrives as `text/plain`:

```json
{ "name": "round_completed", "prop": "3", "props": { "round": 3 } }
```

Same-origin only (403 otherwise; a same-origin `sendBeacon` sends `Sec-Fetch-Site: same-origin`).
Past 100 events per client per 10 minutes, counted in memory per isolate, events are dropped
silently with 204, so one script cannot spend the day's D1 write quota. Each event write also
purges expired rate-limit rows. Only these events and values are counted:

| Event | Allowed `prop` |
| --- | --- |
| `round_completed` | 1-30 (the island sends it at rounds 1, 5, 10, 15, 20, 25 and 30 only) |
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
  shell's own canonical (the site root, `https://cfbblindresume.com`, from Astro `site`); only its
  origin is used.
- `og:image` and `twitter:image`: `{request origin}/og/r/{code}.png`, so preview deployments
  show their own image.
- `og:image:alt` and `twitter:image:alt`: the top 12 written out.

`noindex` is kept (meta tag and `X-Robots-Tag`). An invalid code (garbage, bad checksum, unknown
week, rule violation) gets the shell with its generic tags and canonical + `og:url` rewritten to the
home page, and the island shows its "this link does not open a ranking" panel. The status stays
200 on purpose: Chrome logs a console error for any document served with 404. If the week's data
cannot be read at all (a transient asset error) the generic shell is served unchanged. Headers are
`Cache-Control: public, max-age=0, must-revalidate`, the same as Pages' own HTML, because the shell
references this deploy's hashed assets, plus the anti-framing headers of `public/_headers`
(`X-Frame-Options: DENY`, `Content-Security-Policy: frame-ancestors 'none'`, `Permissions-Policy`),
which Pages does not apply to Functions.

### `GET /og/r/{code}.png`

The share image is computed from the code and the week's game data only. It shows the run's top
12 as lower-third rows: seed plate (accent for the first-round byes), team color block, condensed
caps name and record, and secondary rule, plus a one-line hook under the kicker computed from the
run ("Matched the committee on 43% · Biggest call: Kentucky ▲4"; the triangle is drawn, the font
has none). Layout is DESIGN.md §16, and the reference render matches. `SHARE_IMAGE_VERSION`
(handlers.ts) is part of the cache key: bump it when the layout changes (2 since the hook).

- **Valid code:** `image/png`, `Cache-Control: public, max-age=604800, immutable`. The Cache API
  key is `code + render version + the week asset's ETag`, so each code renders once per colo and
  new data renders anew.
- **Invalid code** (bad base64 or checksum, unknown week, rule violation): `/og/default.png` from
  `env.ASSETS` (the content site's default image), with a 1 h cache. If that asset is missing,
  the function renders a generic brand card instead.
- `X-Share-Image: ranking | default` tells the two cases apart.
- Every image and JSON response carries `X-Robots-Tag: noindex` (`_headers` covers only static
  files, so without it share images on `*.pages.dev` could reach image search).

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

From `npm run fn:bench` (Node 22, the same V8 as workerd; 2026-11-06, with the hook line). The
numbers cover one request after the asset fetch:

| Phase | Warm, median | Warm, p90 |
| --- | --- | --- |
| Decode + `computeRunResults` | 0.58 ms | 0.93 ms |
| Paint | 0.81 ms | 1.05 ms |
| Deflate + CRC | 3.97 ms | 4.43 ms |
| **Total** | **5.5 ms** | **6.0 ms** |

- **Cold** (the first request in a brand-new process, nothing JIT-compiled): 13-15 ms median of 9
  (results 2.7, paint 4.7, deflate 5.7 ms before the hook; the hook adds about 0.1 ms warm).
- **Startup warm-up:** the `/og/r` route runs `warmShareRenderer()` at module scope, i.e. when the
  isolate starts (Workers start isolates during the TLS handshake and limit startup separately
  from request CPU). It indexes the atlas and paints one synthetic image: about 8 ms, once. The
  first request after it measures 10.5 ms median (paint drops from 4.7 to 1.7 ms).
- **In practice** the first image request in an isolate is usually below 10 ms: crawlers fetch
  `/r/{code}` first, which JIT-compiles the same `src/lib` results code (2.7 -> about 0.6 ms), and
  each code renders once per colo (Cache API; a no-op on `*.pages.dev`). The remaining cold cost
  is the native deflate's first call, which no module-scope code can warm (streams are async).
- **CPU cannot be timed from inside workerd** (timers do not advance during computation), so
  there is no Server-Timing header. If `wrangler pages deployment tail` shows 1102 errors
  ("exceeded resource limits") on `/og/r/*`, cold renders are failing and the share preview falls
  back to nothing. The fix is the Workers Paid plan ($5/month, 30 s CPU): the owner's decision,
  recommended before launch (see "Free-plan quotas"); nothing in the code changes.

### Bundle size

`npx wrangler pages functions build --outdir <dir>`: `index.js` is 172 KB and `atlas.bin` is
402 KB, about **160 KB gzipped together**, roughly 5% of the 3 MiB free-plan limit.

## D1

Schema: `migrations/0001_init.sql`.

| Table | Contents |
| --- | --- |
| `votes` | `season, week, a, b, c` (the user's order), `created_day` (UTC date, no time): the raw archive, not read by any endpoint |
| `pair_counts` | `(season, week, winner, loser) -> n`, maintained on insert so the fans endpoints read only a few rows. A week's vote total is `SUM(n) / 3` |
| `rate_limit` | `(hash, window_start) -> count`; rows are deleted 24 h after their window starts, on every vote and event and by the daily purge Action |
| `events` | `(day, name, prop) -> n` |

Migrations: `0001_init.sql` (schema), `0002_lean_vote_writes.sql` (drops the unread
`votes_by_week` index and the `vote_totals` table, which the code no longer uses, so it can be
applied before or after that deploy). A vote writes 5-6 rows, an event 1.

### Privacy (house rule 6)

- No IP address, user id or cookie is stored. The only timestamp finer than a day is
  `rate_limit.window_start`, the hour a rate-limit window starts, stored beside the rotating hash
  and deleted with it after 24 hours.
- The rate-limit key is `SHA-256(IP_SALT | UTC day of the window | address)`, where the address is
  the full IPv4 address or the IPv6 /64. Mixing in the date rotates the salt daily, and keys from
  different days cannot be linked.
- Expired rows are purged on every vote and every event, and daily by
  `.github/workflows/purge-rate-limit.yml` (`wrangler d1 execute ... --remote`, both databases),
  so they go even on days without traffic. That Action needs the repository secrets
  `CLOUDFLARE_API_TOKEN` (Account > D1 > Edit) and `CLOUDFLARE_ACCOUNT_ID`.
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
- **Preview secrets:** `wrangler pages secret put` sets production secrets only (wrangler 4 has no
  `--env` for it). Add `IP_SALT` for previews in the dashboard: Workers & Pages > cfbblindresume >
  Settings > Variables and Secrets > Preview > Add (type Secret), with a different random value.
- **Migrations:** apply them to both databases before deploying code that needs them:
  `npx wrangler d1 migrations apply cfbblindresume --remote` and
  `npx wrangler d1 migrations apply cfbblindresume-preview --remote --env preview`.

### Deploy

Production deploys through the Cloudflare Pages Git integration (build command `npm run build`,
output `dist`; Functions and `wrangler.toml` are picked up automatically). See the root README.
A manual deploy from a shell also works:

```sh
npm run build                                   # Astro -> dist/ (also emits /game-data/*.json and /og/default.png)
npx wrangler pages deploy                       # uses pages_build_output_dir = "dist" and compiles functions/
```

### Free-plan quotas (owner decision before launch)

Per 15-round run the island makes about 21 Function requests while the week has fewer than 20
votes (15 votes, about 5 event beacons: `round_completed` at rounds 1, 5, 10 and 15 plus
`run_completed`, and one `/api/fans/top25`), and about 36 once it has more (plus 15 `/api/fans`).
It writes about 90 D1 rows (5-6 per vote: the vote, three pair counters, the rate-limit counter and
its index on a new window; 1 per event); shared links add `/r/{code}` and `/og/r/{code}.png`.
Workers Free allows 100,000 Function requests and D1 Free 100,000 rows written per day: roughly
2,800 runs a day by requests and 1,100 by D1 writes (before these changes a vote wrote 7-8 rows and
every round sent a beacon and a `/api/fans` request). Past the request
quota, `/r/*` and `/og/r/*` fail too, so shared links break; past the D1 quota, votes and events
answer 503 (the game carries on). Recommended before launch:

- **Workers Paid** ($5/month: 10 million requests and 50 million D1 rows written per month, 30 s
  CPU, which also removes the cold share-image risk above).
- A free **WAF rate-limiting rule** in the Cloudflare dashboard on `/api/*` per IP (for example
  60 requests per 10 seconds, block for 10 minutes) as a backstop for scripts.

## Local development

```sh
echo 'IP_SALT=dev-only-salt-change-me' > .dev.vars          # gitignored
npx wrangler d1 migrations apply cfbblindresume --local
npx astro build --outDir /tmp/site && npx wrangler pages dev /tmp/site --port 8788
```

- `npm run fn:integration` does all of this in a scratch directory (`--skip-build` reuses the
  last build, `--keep` leaves the server running). It exercises every endpoint on workerd: 53
  checks covering votes, 400/403/405/413/415, the rate limit (202, concurrency, IPv6 /64), fans thresholds and caching, top 25, events, `/r/{code}`
  tags, share images and default images, and "no IP in D1". It saves a sample share image and
  writes a JSON summary. Env: `FN_PORT` (8788), `FN_SCRATCH` (output), `FN_DIST` (a prebuilt site),
  `ASTRO_BUILD_LOCK` (run the build under `flock` when several builds share the checkout).
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
