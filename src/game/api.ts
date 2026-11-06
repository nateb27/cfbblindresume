/**
 * Network for the game island. Everything here is optional except the week's game data: votes,
 * events and fan consensus are fire-and-forget or silently absent (the endpoints may not exist in
 * dev or on a preview), and nothing ever blocks the UI on them.
 */
import { GAME_DATA_VERSION, gameDataPath, type GameData } from '@lib/game-data';

/** The week's data file does not exist (an old or mistyped share code). */
export class WeekNotFoundError extends Error {
  constructor(path: string) {
    super(`No game data at ${path}`);
    this.name = 'WeekNotFoundError';
  }
}

const weekCache = new Map<string, Promise<GameData>>();

/**
 * Fetch (once) /game-data/{season}-{week}.json. Rejects with WeekNotFoundError on 404 and a plain
 * Error on network or format problems; a failed fetch is forgotten so "Try again" refetches.
 */
export function loadWeekData(season: number, week: number): Promise<GameData> {
  const path = gameDataPath(season, week);
  let p = weekCache.get(path);
  if (!p) {
    p = fetch(path, { headers: { Accept: 'application/json' } }).then(async (res) => {
      if (res.status === 404) throw new WeekNotFoundError(path);
      if (!res.ok) throw new Error(`Game data request failed (${res.status})`);
      const gd = (await res.json()) as GameData;
      if (!gd || gd.v !== GAME_DATA_VERSION || !Array.isArray(gd.prior)) throw new Error('Unexpected game data format');
      return gd;
    });
    p.catch(() => weekCache.delete(path));
    weekCache.set(path, p);
  }
  return p;
}

/**
 * Endpoints that answered 404 this page view (not deployed, e.g. a preview without Functions): stop
 * calling them so a run does not fire 15 failing requests.
 */
const missing = new Set<string>();

/** sessionStorage key: epoch ms until which votes are not sent (the server said 429 Too Many Requests). */
const VOTE_PAUSE_KEY = 'cfbbr:vote-pause';

function votesPaused(): boolean {
  try {
    const until = Number(window.sessionStorage.getItem(VOTE_PAUSE_KEY) ?? 0);
    return until > Date.now();
  } catch {
    return false;
  }
}

function pauseVotes(retryAfter: string | null): void {
  missing.add('/api/vote');
  const secs = Math.min(Math.max(Number(retryAfter) || 600, 60), 3600);
  try {
    window.sessionStorage.setItem(VOTE_PAUSE_KEY, String(Date.now() + secs * 1000));
  } catch {
    /* storage blocked: the in-memory stop still holds for this page view */
  }
}

/**
 * POST /api/vote after each round (fire-and-forget; survives navigation via keepalive). A 404 (no
 * Functions) stops votes for the page view. Rate limited (the server drops the vote with 202 +
 * `X-Vote-Dropped: rate-limit` + Retry-After; an older deploy answered 429) stops them until
 * Retry-After, also across reloads in this tab, so a long or repeated run wastes no requests.
 */
export function postVote(season: number, week: number, order: readonly string[]): void {
  if (missing.has('/api/vote') || votesPaused()) return;
  try {
    void fetch('/api/vote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ season, week, order }),
      keepalive: true,
    })
      .then((res) => {
        if (res.status === 404) missing.add('/api/vote');
        else if (res.status === 429 || res.headers.get('X-Vote-Dropped')) pauseVotes(res.headers.get('Retry-After'));
      })
      .catch(() => undefined);
  } catch {
    /* never surface */
  }
}

export type GameEvent =
  | { name: 'round_completed'; round: number }
  | { name: 'run_completed'; rounds: number }
  | { name: 'results_shared'; channel: 'copy' | 'webshare' | 'image' }
  | { name: 'skip_to_results'; round: number }
  | { name: 'reveal_disabled' }
  | { name: 'do_another'; round: number };

/**
 * Rounds that send `round_completed` (milestones, not every round: each beacon is a Function
 * request and a D1 write, and the funnel only needs these points).
 */
export const ROUND_MILESTONES: ReadonlySet<number> = new Set([1, 5, 10, 15, 20, 25, 30]);

/** `round_completed` for a milestone round (see ROUND_MILESTONES); other rounds send nothing. */
export function trackRound(round: number): void {
  if (ROUND_MILESTONES.has(round)) track({ name: 'round_completed', round });
}

/**
 * Anonymous counter via navigator.sendBeacon('/api/event'). Body (text/plain JSON, so no preflight):
 * `{ "name": "round_completed", "prop": "3", "props": { "round": 3 } }` — `prop` is the single
 * property value as a string (or null), for the (day, name, prop) counter; `props` keeps its name.
 */
export function track(event: GameEvent): void {
  try {
    const { name, ...props } = event;
    const values = Object.values(props);
    const body = JSON.stringify({ name, prop: values.length ? String(values[0]) : null, props });
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      navigator.sendBeacon('/api/event', body);
    }
  } catch {
    /* analytics never break the game */
  }
}

/** First array of strings in a JSON response: a bare array, or `{ order | ranking | top25 | teams: [...] }`. */
function orderFrom(json: unknown): string[] | null {
  if (Array.isArray(json)) return json.every((s) => typeof s === 'string') ? (json as string[]) : null;
  if (json && typeof json === 'object') {
    for (const key of ['order', 'ranking', 'top25', 'teams', 'consensus']) {
      const v = (json as Record<string, unknown>)[key];
      if (Array.isArray(v)) return orderFrom(v);
      if (v && typeof v === 'object') {
        const inner = orderFrom(v);
        if (inner) return inner;
      }
    }
  }
  return null;
}

async function getOrder(url: string, timeoutMs: number): Promise<string[] | null> {
  const endpoint = url.split('?')[0]!;
  if (missing.has(endpoint)) return null;
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: ctl?.signal });
    if (res.status === 404) missing.add(endpoint);
    if (!res.ok) return null;
    const type = res.headers.get('content-type') ?? '';
    if (!type.includes('json')) return null;
    return orderFrom(await res.json());
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** A trio's fan consensus needs this many votes on every pair (functions/_lib/fans.ts). */
const FANS_MIN_PAIR_VOTES = 20;
/** How long one /api/fans/top25 answer is reused in a page view (the server caches it 300 s). */
const FANS_SUMMARY_TTL_MS = 300_000;

interface FansSummary {
  /** Votes stored for the week, or null when the answer did not say (endpoint missing, error). */
  votes: number | null;
  /** The fans' order (every voted team, best first), or null under the threshold. */
  order: string[] | null;
}

const summaries = new Map<string, { at: number; p: Promise<FansSummary> }>();

/**
 * GET /api/fans/top25 once per week per 5 minutes: `{ votes, order | top25 }`. Shared by the reveal
 * (to skip per-trio requests while the week has too few votes) and the results Fans tab.
 */
function fansSummary(season: number, week: number): Promise<FansSummary> {
  const key = `${season}-${week}`;
  const hit = summaries.get(key);
  if (hit && Date.now() - hit.at < FANS_SUMMARY_TTL_MS) return hit.p;
  const endpoint = '/api/fans/top25';
  const p = (async (): Promise<FansSummary> => {
    if (missing.has(endpoint)) return { votes: null, order: null };
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), 6000) : null;
    try {
      const q = new URLSearchParams({ season: String(season), week: String(week) });
      const res = await fetch(`${endpoint}?${q}`, { headers: { Accept: 'application/json' }, signal: ctl?.signal });
      if (res.status === 404) missing.add(endpoint);
      if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return { votes: null, order: null };
      const json: unknown = await res.json();
      const v = json && typeof json === 'object' ? (json as { votes?: unknown }).votes : undefined;
      const order = orderFrom(json);
      return { votes: typeof v === 'number' && Number.isFinite(v) ? v : null, order: order && order.length ? order : null };
    } catch {
      return { votes: null, order: null };
    } finally {
      if (timer) clearTimeout(timer);
    }
  })();
  summaries.set(key, { at: Date.now(), p });
  return p;
}

/**
 * Fans' consensus order for one trio (GET /api/fans?season&week&trio=a,b,c), or null when the
 * endpoint is missing, under its vote threshold, slow, or returns anything other than the trio.
 * While the week has fewer than FANS_MIN_PAIR_VOTES votes in all (from the shared top-25 summary)
 * no pair can reach the threshold, so no per-trio request is made.
 */
export async function fetchFansTrio(season: number, week: number, trio: readonly string[]): Promise<string[] | null> {
  const { votes } = await fansSummary(season, week);
  if (votes !== null && votes < FANS_MIN_PAIR_VOTES) return null;
  const q = new URLSearchParams({ season: String(season), week: String(week), trio: trio.join(',') });
  const order = await getOrder(`/api/fans?${q}`, 4000);
  if (!order || order.length !== trio.length || !trio.every((s) => order.includes(s))) return null;
  return order;
}

/**
 * Fans' ranking for the week (GET /api/fans/top25): the full voted order when the server sends it
 * (`order`, so the results page can show a next five), else the top 25; null under the threshold
 * or unavailable.
 */
export async function fetchFansTop25(season: number, week: number): Promise<string[] | null> {
  return (await fansSummary(season, week)).order;
}
