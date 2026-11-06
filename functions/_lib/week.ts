/**
 * The week's game data (/game-data/{season}-{week}.json, emitted by the Astro build), read through
 * the Pages ASSETS binding and kept parsed per isolate. Static assets only change with a deploy and
 * a deploy starts new isolates, so the cache never serves stale data for long; entries still expire
 * after ten minutes and at most a few weeks are kept.
 */
import { GAME_DATA_VERSION, gameDataPath, type GameData } from '@lib/game-data';
import type { Env } from './cf';

export interface LoadedWeek {
  data: GameData;
  /** Pool as a set (votes are validated against it). */
  pool: ReadonlySet<string>;
  /** Asset ETag (or a fallback), used in cache keys so new data renders anew. */
  etag: string;
}

const TTL_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 8;
const cache = new Map<string, { at: number; week: LoadedWeek | null }>();

/**
 * Load a week's game data, or null if that week has no data file (or the file is not game data).
 * Throws only when the asset fetch itself fails.
 */
export async function loadGameWeek(env: Pick<Env, 'ASSETS'>, requestUrl: string, season: number, week: number, nowMs = Date.now()): Promise<LoadedWeek | null> {
  const path = gameDataPath(season, week);
  const hit = cache.get(path);
  if (hit && nowMs - hit.at < TTL_MS) return hit.week;
  const res = await env.ASSETS.fetch(new URL(path, requestUrl));
  let loaded: LoadedWeek | null = null;
  if (res.ok && (res.headers.get('Content-Type') ?? '').includes('json')) {
    try {
      const data = (await res.json()) as GameData;
      if (data && data.v === GAME_DATA_VERSION && data.season === season && data.week === week && Array.isArray(data.prior)) {
        loaded = { data, pool: new Set(data.prior), etag: (res.headers.get('ETag') ?? data.asOf).replace(/[^A-Za-z0-9._-]/g, '') };
      }
    } catch {
      loaded = null;
    }
  } else {
    await res.body?.cancel();
  }
  if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value!);
  cache.set(path, { at: nowMs, week: loaded });
  return loaded;
}

/** Test hook: forget cached weeks. */
export function clearWeekCache(): void {
  cache.clear();
}
