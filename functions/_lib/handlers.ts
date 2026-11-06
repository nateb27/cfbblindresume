/**
 * Endpoint logic for every Function. Route files under functions/ are thin wrappers, so these
 * handlers can be exercised in Node tests with a fake ASSETS binding and a SQLite-backed D1.
 */
import { parseShareCode } from '@lib/sharecode';
import type { Atlas } from './atlas';
import { defaultCache, htmlRewriter, type Env } from './cf';
import { FANS_MIN_PAIR_VOTES, FANS_TOP25_MIN_VOTES, FANS_TOP_N, fansOrder, trioConsensus, votesFromPairs, type PairCount } from './fans';
import { errorResponse, forbiddenCrossSite, intParam, json, methodNotAllowed, noContent, NOINDEX, PAGE_SECURITY_HEADERS, readJsonBody, sameOrigin } from './http';
import { clientIp, effectiveSalt, hashClient, MemoryLimiter, purgeStatement, rateKeyAddress, utcDay, voteBatch, windowKeys, type GuardedWrite } from './ratelimit';
import { renderBrandImage, renderShareImage, shareImageAlt, shareImageModel } from './share-image';
import { openSharedRun, plausibleCode, sharedMeta } from './shared';
import { parseEvent, parseTrioParam, parseVote, validSeasonWeek, voteInPool } from './validate';
import { loadGameWeek } from './week';

type WaitUntil = (p: Promise<unknown>) => void;

const isRead = (m: string): boolean => m === 'GET' || m === 'HEAD';

/** HEAD gets the same headers without a body. */
function forMethod(request: Request, res: Response): Response {
  return request.method === 'HEAD' ? new Response(null, { status: res.status, headers: res.headers }) : res;
}

/** Serve from the zone cache, else build, cache (when cacheable) and serve. */
async function cached(request: Request, key: string, waitUntil: WaitUntil, build: () => Promise<Response>): Promise<Response> {
  const cache = defaultCache();
  const keyReq = new Request(key, { method: 'GET' });
  if (cache) {
    const hit = await cache.match(keyReq);
    if (hit) return forMethod(request, hit);
  }
  const res = await build();
  if (cache && res.status === 200 && /max-age=[1-9]/.test(res.headers.get('Cache-Control') ?? '')) {
    waitUntil(cache.put(keyReq, res.clone()).catch(() => undefined));
  }
  return forMethod(request, res);
}

/* ------------------------------------------------------------------ POST /api/vote */

/** Header on a vote the rate limit dropped (status 202, so browsers log nothing). */
export const VOTE_DROPPED_HEADER = 'X-Vote-Dropped';

export async function handleVote(request: Request, env: Env, nowMs = Date.now()): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed(['POST']);
  if (!sameOrigin(request)) return forbiddenCrossSite();
  const body = await readJsonBody(request);
  if (!body.ok) return errorResponse(body.status, body.error);
  const vote = parseVote(body.value);
  if (!vote.ok) return errorResponse(400, vote.error);
  const { season, week, order } = vote.value;
  const wk = await loadGameWeek(env, request.url, season, week);
  if (!wk) return errorResponse(400, `No game data for ${season} week ${week}.`);
  const inPool = voteInPool(order, wk.pool);
  if (!inPool.ok) return errorResponse(400, inPool.error);
  const db = env.DB;
  if (!db) return errorResponse(503, 'Vote storage is not configured.');
  try {
    const nowSec = Math.floor(nowMs / 1000);
    const keys = await windowKeys(rateKeyAddress(clientIp(request)), effectiveSalt(env.IP_SALT), nowSec);
    const [a, b, c] = order;
    const pair = (w: string, l: string): GuardedWrite => ({
      insertSelect: 'INSERT INTO pair_counts (season, week, winner, loser, n) SELECT ?1, ?2, ?3, ?4, 1',
      tail: 'ON CONFLICT (season, week, winner, loser) DO UPDATE SET n = n + 1',
      params: [season, week, w, l],
    });
    const decision = await voteBatch(db, keys, nowSec, [
      { insertSelect: 'INSERT INTO votes (season, week, a, b, c, created_day) SELECT ?1, ?2, ?3, ?4, ?5, ?6', params: [season, week, a, b, c, utcDay(nowMs)] },
      pair(a, b),
      pair(a, c),
      pair(b, c),
    ]);
    if (!decision.allowed) {
      // Over the limit: the vote is not stored. Answer 2xx (a 429 would log a console error in the
      // player's browser on every round); Retry-After and the header tell the island to pause.
      return json({ dropped: 'rate-limit', retryAfter: decision.retryAfter }, 202, {
        'Cache-Control': 'no-store',
        'Retry-After': String(decision.retryAfter),
        [VOTE_DROPPED_HEADER]: 'rate-limit',
      });
    }
    return noContent();
  } catch {
    return errorResponse(503, 'Vote storage is unavailable.');
  }
}

/* ------------------------------------------------------------------ GET /api/fans */

export async function handleFans(request: Request, env: Env, waitUntil: WaitUntil = () => undefined): Promise<Response> {
  if (!isRead(request.method)) return methodNotAllowed(['GET', 'HEAD']);
  const url = new URL(request.url);
  const sw = validSeasonWeek(intParam(url, 'season'), intParam(url, 'week'));
  if (!sw.ok) return errorResponse(400, sw.error);
  const trio = parseTrioParam(url.searchParams.get('trio'));
  if (!trio.ok) return errorResponse(400, trio.error);
  const db = env.DB;
  if (!db) return errorResponse(503, 'Vote storage is not configured.');
  const { season, week } = sw.value;
  const sorted = [...trio.value].sort();
  const key = `${url.origin}/api/fans?season=${season}&week=${week}&trio=${sorted.join(',')}`;
  try {
    return await cached(request, key, waitUntil, async () => {
      const { results } = await db
        .prepare('SELECT winner, loser, n FROM pair_counts WHERE season = ?1 AND week = ?2 AND winner IN (?3, ?4, ?5) AND loser IN (?3, ?4, ?5)')
        .bind(season, week, ...sorted)
        .all<PairCount>();
      const c = trioConsensus(sorted, results);
      return json(
        { season, week, trio: sorted, threshold: FANS_MIN_PAIR_VOTES, minPairVotes: c.minPairVotes, consensus: c.consensus, counts: c.counts },
        200,
        { 'Cache-Control': 'public, max-age=60' },
      );
    });
  } catch {
    return errorResponse(503, 'Vote storage is unavailable.');
  }
}

/* ------------------------------------------------------------------ GET /api/fans/top25 */

export async function handleFansTop25(request: Request, env: Env, waitUntil: WaitUntil = () => undefined): Promise<Response> {
  if (!isRead(request.method)) return methodNotAllowed(['GET', 'HEAD']);
  const url = new URL(request.url);
  const sw = validSeasonWeek(intParam(url, 'season'), intParam(url, 'week'));
  if (!sw.ok) return errorResponse(400, sw.error);
  const db = env.DB;
  if (!db) return errorResponse(503, 'Vote storage is not configured.');
  const { season, week } = sw.value;
  const key = `${url.origin}/api/fans/top25?season=${season}&week=${week}`;
  try {
    return await cached(request, key, waitUntil, async () => {
      // Every vote adds exactly three pairwise counts (1st>2nd, 1st>3rd, 2nd>3rd), so the week's
      // vote total is their sum / 3: no separate totals row to write on every vote.
      const { results } = await db.prepare('SELECT winner, loser, n FROM pair_counts WHERE season = ?1 AND week = ?2').bind(season, week).all<PairCount>();
      // `votes` is always present: the island skips per-trio /api/fans requests while it is under
      // FANS_MIN_PAIR_VOTES (no pair can have more votes than the week). `order` is every voted
      // team (the fans' next five past 25); `top25` its first 25.
      const votes = votesFromPairs(results);
      let order: string[] | null = null;
      if (votes >= FANS_TOP25_MIN_VOTES) {
        const full = fansOrder(results);
        order = full.length ? full : null;
      }
      const top25 = order ? order.slice(0, FANS_TOP_N) : null;
      return json({ season, week, votes, threshold: FANS_TOP25_MIN_VOTES, top25, order }, 200, { 'Cache-Control': 'public, max-age=300' });
    });
  } catch {
    return errorResponse(503, 'Vote storage is unavailable.');
  }
}

/* ------------------------------------------------------------------ POST /api/event */

/**
 * Events per client per 10 minutes, per isolate. A 30-round run sends about 35 events; past the cap
 * events are dropped silently (204), so one script cannot spend the day's D1 write quota.
 */
export const EVENT_LIMIT = Object.freeze({ limit: 100, windowSec: 600 });
const eventLimiter = new MemoryLimiter(EVENT_LIMIT.limit, EVENT_LIMIT.windowSec);

export async function handleEvent(request: Request, env: Env, nowMs = Date.now()): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed(['POST']);
  if (!sameOrigin(request)) return forbiddenCrossSite();
  const body = await readJsonBody(request, { maxBytes: 1024, allowTextPlain: true });
  if (!body.ok) return errorResponse(body.status, body.error);
  const ev = parseEvent(body.value);
  if (!ev.ok) return errorResponse(400, ev.error);
  const db = env.DB;
  if (!db) return errorResponse(503, 'Event storage is not configured.');
  try {
    const nowSec = Math.floor(nowMs / 1000);
    const who = await hashClient(rateKeyAddress(clientIp(request)), effectiveSalt(env.IP_SALT), utcDay(nowMs));
    if (!eventLimiter.hit(who, nowSec)) return noContent();
    await db.batch([
      // Also purge expired rate-limit rows here, so they go even on days without votes.
      purgeStatement(db, nowSec),
      db
        .prepare('INSERT INTO events (day, name, prop, n) VALUES (?1, ?2, ?3, 1) ON CONFLICT (day, name, prop) DO UPDATE SET n = n + 1')
        .bind(utcDay(nowMs), ev.value.name, ev.value.prop),
    ]);
    return noContent();
  } catch {
    return errorResponse(503, 'Event storage is unavailable.');
  }
}

/* ------------------------------------------------------------------ GET /r/{code} */

/** Path of the static results shell (src/pages/r.astro -> r.html, served at /r). */
export const SHELL_PATH = '/r';

const PAGE_HEADERS: Record<string, string> = {
  'Content-Type': 'text/html; charset=utf-8',
  // The shell references hashed assets of the current deploy: revalidate like Pages' own HTML.
  'Cache-Control': 'public, max-age=0, must-revalidate',
  'X-Robots-Tag': 'noindex',
  // public/_headers does not apply to Functions: same anti-framing headers as the static pages.
  ...PAGE_SECURITY_HEADERS,
};

/**
 * The shell for a share link. Valid codes get per-code tags. A code that cannot be opened (garbage,
 * bad checksum, unknown week, rule violation) gets the generic shell with canonical and og:url
 * pointing at the home page (the page is noindex either way), and the island renders its friendly
 * "this link does not open a ranking" panel. It stays HTTP 200 on purpose: Chrome logs a console
 * error for any document served with 404, and a mistyped share link is a page people land on.
 * If the week's data cannot be read at all (a transient asset error), the generic shell is served
 * unchanged and the island retries.
 */
export async function handleSharedPage(request: Request, env: Env, code: string): Promise<Response> {
  if (!isRead(request.method)) return methodNotAllowed(['GET', 'HEAD']);
  const shell = await env.ASSETS.fetch(new URL(SHELL_PATH, request.url));
  if (!shell.ok) return shell;
  let opened: Awaited<ReturnType<typeof openSharedRun>>;
  try {
    opened = await openSharedRun(env, request.url, code);
  } catch {
    return forMethod(request, new Response(shell.body, { status: 200, headers: PAGE_HEADERS }));
  }
  const Rewriter = htmlRewriter();
  const reqOrigin = new URL(request.url).origin;
  const siteOriginOf = (href: string | null): string => {
    try {
      return new URL(href ?? '', reqOrigin).origin;
    } catch {
      return reqOrigin;
    }
  };

  if (!opened.ok) {
    const res = new Response(shell.body, { status: 200, headers: PAGE_HEADERS });
    if (!Rewriter) return forMethod(request, res);
    let home = `${reqOrigin}/`;
    const page = new Rewriter()
      .on('link[rel="canonical"]', {
        element: (el) => {
          home = `${siteOriginOf(el.getAttribute('href'))}/`;
          el.setAttribute('href', home);
        },
      })
      .on('meta[property="og:url"]', { element: (el) => void el.setAttribute('content', home) })
      .transform(res);
    return forMethod(request, page);
  }
  if (!Rewriter) return forMethod(request, new Response(shell.body, { status: 200, headers: PAGE_HEADERS }));

  const gd = opened.week.data;
  const model = shareImageModel(gd, opened.results.ranking.order, opened.results.playoff.byes.map((s) => s.slug), opened.results.agreement);
  let siteOrigin = reqOrigin;
  const run = opened;
  const meta = () => sharedMeta(gd, run.rounds.length, run.results, code, siteOrigin, reqOrigin, shareImageAlt(model));
  let m = meta();
  const set = (attr: string, value: () => string) => ({ element: (el: { setAttribute(n: string, v: string): unknown }) => void el.setAttribute(attr, value()) });
  const page = new Rewriter()
    .on('title', { element: (el) => void el.setInnerContent(m.title) })
    .on('meta[name="description"]', set('content', () => m.description))
    .on('link[rel="canonical"]', {
      element: (el) => {
        siteOrigin = siteOriginOf(el.getAttribute('href'));
        m = meta();
        el.setAttribute('href', m.url);
      },
    })
    .on('meta[property="og:title"]', set('content', () => m.socialTitle))
    .on('meta[property="og:description"]', set('content', () => m.description))
    .on('meta[property="og:url"]', set('content', () => m.url))
    .on('meta[property="og:image"]', set('content', () => m.image))
    .on('meta[property="og:image:alt"]', set('content', () => m.imageAlt))
    .on('meta[name="twitter:title"]', set('content', () => m.socialTitle))
    .on('meta[name="twitter:description"]', set('content', () => m.description))
    .on('meta[name="twitter:image"]', set('content', () => m.image))
    .on('meta[name="twitter:image:alt"]', set('content', () => m.imageAlt))
    .transform(new Response(shell.body, { status: 200, headers: PAGE_HEADERS }));
  return forMethod(request, page);
}

/* ------------------------------------------------------------------ GET /og/r/{code}.png */

/** Bump when the image layout changes, so cached renders are replaced. */
export const SHARE_IMAGE_VERSION = 2;
/** Static fallback image (src/pages/og/default.png.ts). Never wrapped for HEAD here (callers do). */
export const DEFAULT_IMAGE_PATH = '/og/default.png';

const IMAGE_CACHE = 'public, max-age=604800, immutable';
const DEFAULT_IMAGE_CACHE = 'public, max-age=3600';

function png(body: Uint8Array | ReadableStream | null, cacheControl: string, extra: Record<string, string> = {}): Response {
  return new Response(body as BodyInit | null, {
    status: 200,
    headers: { 'Content-Type': 'image/png', 'Cache-Control': cacheControl, 'X-Content-Type-Options': 'nosniff', ...NOINDEX, ...extra },
  });
}

async function defaultImage(request: Request, env: Env, atlasFor: () => Atlas): Promise<Response> {
  const res = await env.ASSETS.fetch(new URL(DEFAULT_IMAGE_PATH, request.url));
  if (res.ok && (res.headers.get('Content-Type') ?? '').startsWith('image/png')) {
    return png(res.body, DEFAULT_IMAGE_CACHE, { 'X-Share-Image': 'default' });
  }
  await res.body?.cancel();
  return png(await renderBrandImage(atlasFor()), DEFAULT_IMAGE_CACHE, { 'X-Share-Image': 'default' });
}

export async function handleShareImage(request: Request, env: Env, rawCode: string, atlasFor: () => Atlas, waitUntil: WaitUntil = () => undefined): Promise<Response> {
  if (!isRead(request.method)) return methodNotAllowed(['GET', 'HEAD']);
  const code = rawCode.replace(/\.png$/i, '');
  if (!plausibleCode(code)) return forMethod(request, await defaultImage(request, env, atlasFor));
  // Cheap checks first (decode + the week's asset), so a cache hit never computes the ranking.
  const raw = parseShareCode(code);
  const wk = raw.ok ? await loadGameWeek(env, request.url, raw.value.season, raw.value.week) : null;
  if (!wk) return forMethod(request, await defaultImage(request, env, atlasFor));
  const key = `${new URL(request.url).origin}/og/r/${code}.png?v=${SHARE_IMAGE_VERSION}-${wk.etag}`;
  return cached(request, key, waitUntil, async () => {
    const opened = await openSharedRun(env, request.url, code);
    if (!opened.ok) return defaultImage(request, env, atlasFor);
    const gd = opened.week.data;
    const model = shareImageModel(gd, opened.results.ranking.order, opened.results.playoff.byes.map((s) => s.slug), opened.results.agreement);
    return png(await renderShareImage(model, atlasFor()), IMAGE_CACHE, { 'X-Share-Image': 'ranking' });
  });
}
