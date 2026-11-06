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

/** POST /api/vote after each round (fire-and-forget; survives navigation via keepalive). */
export function postVote(season: number, week: number, order: readonly string[]): void {
  if (missing.has('/api/vote')) return;
  try {
    void fetch('/api/vote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ season, week, order }),
      keepalive: true,
    })
      .then((res) => {
        if (res.status === 404) missing.add('/api/vote');
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

/**
 * Fans' consensus order for one trio (GET /api/fans?season&week&trio=a,b,c), or null when the
 * endpoint is missing, under its vote threshold, slow, or returns anything other than the trio.
 */
export async function fetchFansTrio(season: number, week: number, trio: readonly string[]): Promise<string[] | null> {
  const q = new URLSearchParams({ season: String(season), week: String(week), trio: trio.join(',') });
  const order = await getOrder(`/api/fans?${q}`, 4000);
  if (!order || order.length !== trio.length || !trio.every((s) => order.includes(s))) return null;
  return order;
}

/** Fans' top 25 for the week (GET /api/fans/top25), or null under the threshold / unavailable. */
export async function fetchFansTop25(season: number, week: number): Promise<string[] | null> {
  const q = new URLSearchParams({ season: String(season), week: String(week) });
  const order = await getOrder(`/api/fans/top25?${q}`, 6000);
  return order && order.length ? order : null;
}
