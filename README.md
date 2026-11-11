# cfbblindresume.com

An independent College Football Playoff resume site. **Same game. Different numbers.**

- **The blind-resume game** (`/`): three anonymized resumes per round, you rank them 1-2-3, a
  reveal shows who they were, and after 15 rounds (up to 30 with "Do another") you get your own
  top 25 and playoff bracket next to the selection committee, FEI and other fans. The 12-team
  2026 format is the default; the proposed 24-team format is one tap away. Results get a share
  link (`/r/{code}`) with its own preview image.
- **Static resume pages** that work without JavaScript: one page per FBS team (`/teams/{slug}`),
  current and archived rankings (`/rankings`, `/rankings/{season}/week-{N}`), every pairwise
  compare of the committee top 25 (`/compare/{a}-vs-{b}`), the bubble (`/bubble`), plus
  `/how-it-works`, `/about`, `/privacy`.

Every number is from **FEI by Brian Fremeau** ([bcftoys.com](https://bcftoys.com)) or computed
from raw scores ([CollegeFootballData.com](https://collegefootballdata.com)); the committee
ranking comes from [collegefootballplayoff.com](https://collegefootballplayoff.com/rankings).
The site uses no ESPN-produced metric and no logos.

`SPEC.md` is the binding build contract (data schema, algorithms, site map, house rules),
`DESIGN.md` the design system, `src/lib/README.md` the shared library API,
`functions/README.md` the backend, `pipeline/README.md` the weekly data pipeline.

## How it fits together

```
pipeline/ (Python)  --weekly-->  data/{season}/week-N.json  (committed; the single source of truth)
                                        |
                       npm run build (Astro 7, static)        src/lib/ (pure TypeScript, shared)
                                        |
        dist/: every content page as HTML, /game-data/{season}-{week}.json, OG images,
               sitemap.xml, robots.txt, _headers, _redirects
                                        |
  Cloudflare Pages  +  functions/ (Pages Functions: /api/*, /r/{code}, /og/r/{code}.png)  +  D1
```

| Path | What |
| --- | --- |
| `data/` | Weekly snapshots (`week-N.json`) and `index.json` per season. Never edit by hand except to fix a validator failure. |
| `pipeline/` | Fetch FEI + CFBD + committee, join, validate, write. Standard library + `requests`. |
| `src/lib/` | Schema (`types.ts`), tiers, pool, ranking (committee prior + ranked pairs + isotonic projection), trio selection, Bradley-Terry, share codes, playoff formats and brackets, agreement. Pure and tested. |
| `src/pages/`, `src/components/`, `src/layouts/`, `src/styles/` | Astro content pages and the design system. |
| `src/game/` | The React 19 island (Zustand store) for `/` and `/r/{code}`. |
| `functions/` | Cloudflare Pages Functions (votes, fans consensus, events, shared-link tags, share images). |
| `migrations/` | D1 schema. |
| `tests/` | Vitest unit tests (lib, data, Functions with SQLite-backed D1). Pipeline tests are in `pipeline/tests/`. |
| `scripts/` | Verification helpers (content checks, game end-to-end, Functions integration and benchmark). |

## Local setup

Requirements: Node 22 (`.node-version`; Node 22.5+ for the Functions tests, which use
`node:sqlite`), npm. Python 3.12+ only for the data pipeline.

```sh
npm ci
npm run build            # -> dist/
npm test
```

To see the site with the Functions and a local D1:

```sh
echo 'IP_SALT=dev-only-salt-change-me' > .dev.vars        # gitignored
npx wrangler d1 migrations apply cfbblindresume --local
npm run build && npx wrangler pages dev dist --port 8788   # http://127.0.0.1:8788
```

`npm run dev` (Astro dev server) works for content pages; it does not run the Functions, so the
game plays but votes, fans and shared-link tags are absent.

The build needs no network beyond npm and no Python: the data is committed, and the share-image
glyph atlas (`functions/_lib/atlas.bin`) is prebuilt.

## Commands

| Command | What it does |
| --- | --- |
| `npm run build` | Astro static build into `dist/` (pages, `/game-data/*.json`, OG images, sitemap). This is what Cloudflare runs. |
| `npm test` | Vitest: `src/lib` (including launch criterion 7: always picking the committee order gives the committee top 25), every committed week file, the Functions handlers on a SQLite D1. |
| `npm run check` | `astro check` (types in `.astro` files). Also run `npx tsc --noEmit -p .`. |
| `npm run pipeline -- --season 2026` | Build this week's data file (`python3 pipeline/run.py`; see `pipeline/README.md` for flags such as `--fei-csv`, `--use-cache`, `--dry-run`). |
| `npm run validate -- --all` | Validate every week file and `index.json` (`python3 pipeline/validate.py`). |
| `python3 -m unittest discover -s pipeline/tests -p "test_*.py"` | Pipeline tests. |
| `node scripts/content-verify.mjs dist` | Content checks on a build: page counts, unique titles and descriptions, canonicals, no-JS, banned strings only on /about, sitemap, compare links and redirects. |
| `node scripts/e2e-game.mjs --dist dist --out <dir>` | Playwright end-to-end game run (phone and laptop flows, criterion 7, share links, bad codes); serves the build itself with mocked `/api/*`. `--base <url>` runs against a live server instead. |
| `npm run fn:integration` | Builds, applies migrations to a fresh local D1, runs `wrangler pages dev` and checks every endpoint on workerd (votes, rate limit, CSRF, fans, events, `/r/{code}` tags, share images, privacy). Flags and env in `functions/README.md`. |
| `npm run fn:bench` | CPU benchmark of the share-image renderer (free plan: 10 ms per request). |
| `npm run fn:atlas` | Rebuild the share-image glyph atlas after changing fonts or sizes (`--check` verifies the committed copy). |
| `npm run preview` | `wrangler pages dev dist`. |

## Environment variables

| Name | Where | Used by |
| --- | --- | --- |
| `CFBD_API_KEY` | GitHub repository secret (and your shell for local pipeline runs) | The pipeline: CollegeFootballData.com API key (free), sent as `Authorization: Bearer`. |
| `PUBLIC_ADS` | Build time | `on` renders the reserved, height-locked ad slots; anything else (default) renders none. |
| `PUBLIC_AD_NETWORK` | Build time | Name of the ad network; the loader stub runs only when it is set (after first interaction or 3 s) and only on pages with a slot. The privacy page names it. |
| `IP_SALT` | Pages secret, production and preview (`.dev.vars` locally) | Salt for the hashed client address used by the vote rate limit. Without it the Functions use a random per-isolate salt (privacy holds; rate limiting weakens). |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | GitHub repository secrets (and your shell for `wrangler` deploys/migrations) | The daily rate-limit purge Action (token permission: Account > D1 > Edit). |

`PUBLIC_*` values are read by Astro when the site is built. `wrangler.toml` sets
`PUBLIC_ADS = "off"`. To turn ads on, set `PUBLIC_ADS=on` and `PUBLIC_AD_NETWORK` where the
Cloudflare build reads its environment (the Pages project's variables, and `wrangler.toml` [vars]
for production and `[env.preview]`), redeploy, and check that the built pages show the
"Advertisement" slots.

## Weekly data flow

1. `.github/workflows/weekly-data.yml` runs Monday 14:00 UTC (FEI updates) and Wednesday 06:00
   UTC (after the Tuesday-night committee release), August to December, or by hand.
2. It runs the pipeline tests, `pipeline/run.py` (FEI "through Week N" + CFBD games through week N
   + the committee release that follows week N), `validate.py --all`, then `npm ci`, `npm test`
   and `npm run build` against the new data.
3. Only if all of that passes and the data changed, it commits `data/` (and
   `pipeline/slugs.json`) to `main`. That push triggers the Cloudflare Pages build and deploy.
4. If bcftoys.com blocks the runners, paste the FEI table into `pipeline/manual/{season}-fei.csv`
   and start the workflow by hand with `fei_csv` (`pipeline/README.md`, "CSV fallback"). The parser
   and validator reject rank or value typos in a paste.
5. Each August: add the season to `pipeline/playoff_formats.json`, `pipeline/conferences.json`
   (after checking realignment) and `pipeline/committee_schedule.json`.

Other workflows: `ci.yml` runs unit tests, type and Astro checks, the build, the pipeline tests
and the validator on every push and pull request; `purge-rate-limit.yml` deletes expired
rate-limit rows daily (privacy promise on days without traffic).

## Deploy (Cloudflare Pages, Git integration)

Cloudflare builds from GitHub on every push: `npm clean-install`, `npm run build`, output `dist`,
`functions/` compiled automatically. `wrangler.toml` is the source of truth for bindings: the
`DB` D1 binding (`cfbblindresume`) for production and `[env.preview]` with the separate
`cfbblindresume-preview` database for every other branch, so test votes never reach production.
It also sets `compatibility_flags = ["nodejs_compat"]` (both environments): the share image
(`/og/r/{code}.png`) deflates its PNG with `node:zlib`. If the project's compatibility settings are
ever managed in the dashboard instead (Settings > Runtime), turn `nodejs_compat` on there for
production and preview, or the share image errors.

One-time setup:

1. Cloudflare dashboard: Workers & Pages > Create > Pages > Connect to Git, pick the repository,
   production branch `main`, framework preset none (or Astro), build command `npm run build`,
   output directory `dist`. Node comes from `.node-version` (22).
2. Databases (ids already in `wrangler.toml`; create them only for a new account and paste the
   new ids): `npx wrangler d1 create cfbblindresume`, `npx wrangler d1 create cfbblindresume-preview`.
3. Migrations, on both databases, whenever `migrations/` changes:

   ```sh
   npx wrangler d1 migrations apply cfbblindresume --remote
   npx wrangler d1 migrations apply cfbblindresume-preview --remote --env preview
   ```

   Apply them before deploying code that needs a new table or column. `0002_lean_vote_writes.sql`
   only drops things the code no longer uses, so its order does not matter.
4. Secrets: `openssl rand -hex 32 | npx wrangler pages secret put IP_SALT --project-name cfbblindresume`
   for production; for previews add `IP_SALT` (a different value) in the dashboard under
   Settings > Variables and Secrets > Preview.
5. GitHub repository secrets: `CFBD_API_KEY` (weekly data), `CLOUDFLARE_API_TOKEN` and
   `CLOUDFLARE_ACCOUNT_ID` (daily purge).
6. Plan: the Workers Free plan allows 100,000 Function requests and 100,000 D1 rows written per
   day (roughly 950 full game runs a day, set by D1 writes) and 10 ms CPU per request, which a
   share image in a freshly started isolate can exceed. **Workers Paid ($5/month) is recommended before launch**; also add a
   free WAF rate-limiting rule on `/api/*`. Details and measurements: `functions/README.md`,
   "Free-plan quotas" and "Measured CPU".

## Domain

- Add `cfbblindresume.com` as the Pages project's custom domain (Cloudflare DNS creates the
  record); add `www.cfbblindresume.com` too and redirect it to the apex (a Redirect Rule or Bulk
  Redirect), so there is one canonical host.
- Canonical URLs, Open Graph URLs and the sitemap use `https://cfbblindresume.com` with no
  trailing slash (Astro `site`, `trailingSlash: 'never'`, `build.format: 'file'`).
- Every `*.pages.dev` address (production alias and previews) sends `X-Robots-Tag: noindex`
  (`public/_headers` for static files; the Functions send it on their own responses), so only the
  custom domain is indexed. Every page also sends `X-Frame-Options: DENY`,
  `Content-Security-Policy: frame-ancestors 'none'` and a restrictive `Permissions-Policy`.
- Shared-link images are served from the request's own origin, so preview deployments preview
  their own images.

## Privacy and analytics

No accounts, no cookies, no third-party analytics. The game posts each ranked round to
`/api/vote` (anonymous: season, week, three slugs, UTC date) for the fans consensus, and a few
anonymous counters to `/api/event` (round completed, run completed, shared, ...: day, name, one
allowlisted value). The only per-client value stored is a salted SHA-256 of the IPv4 address or
IPv6 /64 for the vote rate limit, with a salt that rotates daily, deleted 24 hours after its hour
window starts. See `/privacy` and `functions/README.md`.

## Deviations from the original plan

These are also listed in `SPEC.md` ("Deviations from the plan").

1. **Astro 7** (current) instead of Astro 5.
2. **Cloudflare Pages Functions + D1** instead of a separate Worker with routes: same origin as the
   site, works on preview deployments, one deploy.
3. **Our own `/api/event` analytics in D1** instead of Plausible: free, first-party, cookie-free,
   counters only.
4. **FEI by Brian Fremeau as the ratings source** (FEI, offense, defense, schedule strength and
   strength of record), plus raw scores from CollegeFootballData.com; no ESPN-produced metric.
5. **Two playoff formats**: the 12-team 2026 format is the default everywhere; the proposed 24-team
   format (labeled "Proposed for 2027 — not final", source Deseret News) is a toggle on results and
   content pages. Formats live in `pipeline/playoff_formats.json` and travel in the week file.
6. Your ranking starts from the committee's ranking and moves teams with your picks (ranked pairs
   + isotonic projection), not raw Bradley-Terry, so always agreeing with the committee gives
   exactly the committee top 25. Bradley-Terry still drives adaptive trio selection and the fans'
   top 25.
7. Every pool team is guaranteed to appear within 15 rounds; only runs ended early show unseen
   teams. "Do another" continues to 30 rounds.
8. Fans' consensus counts pairwise votes (at least 20 per pair) instead of exact trios.
9. The FBS team count is data-driven (138 in 2026).
10. Automatic bids come from the format config: the five highest-ranked conference champions plus
    Notre Dame if ranked in the top 12 (12-team); the four power-conference champions plus the best
    other champion (24-team).
11. Each team's remaining schedule (`upcoming`) is an additive week-file field, for "still to play"
    views.
