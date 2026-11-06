/**
 * Vote rate limiting: 30 votes per rolling hour per client, keyed by a salted hash of the IP.
 *
 * Privacy (SPEC house rule 6): the IP is never stored. The key is SHA-256(salt | UTC day | IP) with
 * the secret `IP_SALT`; mixing in the day rotates the salt daily, so keys cannot be linked across
 * days, and rows older than 24 hours are deleted on every write.
 *
 * Counting uses fixed one-hour windows with the sliding-window approximation: the previous window's
 * count is weighted by how much of it still overlaps the last hour. This avoids the double burst a
 * plain fixed window allows at the boundary while storing only two counters per client.
 */
import type { D1Database } from './cf';

export const RATE_LIMIT = Object.freeze({
  /** Votes allowed per rolling window. */
  limit: 30,
  /** Window length (s). */
  windowSec: 3600,
  /** Rate-limit rows are deleted after this long (s). */
  retentionSec: 24 * 3600,
});

/** Start (unix s) of the fixed window containing `nowSec`. */
export function windowStart(nowSec: number, windowSec = RATE_LIMIT.windowSec): number {
  return Math.floor(nowSec / windowSec) * windowSec;
}

/** Estimated requests in the rolling window ending now. */
export function slidingCount(current: number, previous: number, nowSec: number, windowSec = RATE_LIMIT.windowSec): number {
  const elapsed = nowSec - windowStart(nowSec, windowSec);
  return current + previous * Math.max(0, (windowSec - elapsed) / windowSec);
}

/**
 * Whether one more request is allowed, given the requests already counted in the current window
 * and the previous window's count. Rejected requests are not counted.
 */
export function allowed(current: number, previous: number, nowSec: number, limit = RATE_LIMIT.limit, windowSec = RATE_LIMIT.windowSec): boolean {
  return slidingCount(current + 1, previous, nowSec, windowSec) <= limit;
}

/**
 * Seconds until one more request would be allowed (for Retry-After): when the weighted previous
 * window has decayed enough, else when the current window ends. At least 1.
 */
export function retryAfterSec(current: number, previous: number, nowSec: number, limit = RATE_LIMIT.limit, windowSec = RATE_LIMIT.windowSec): number {
  const start = windowStart(nowSec, windowSec);
  const toWindowEnd = start + windowSec - nowSec;
  // current + 1 + previous * (windowSec - e) / windowSec <= limit
  //   =>  e >= windowSec * (1 - (limit - current - 1) / previous)
  if (previous > 0 && current + 1 <= limit) {
    const need = windowSec * (1 - (limit - current - 1) / previous);
    return Math.max(1, Math.min(toWindowEnd, Math.ceil(start + need - nowSec)));
  }
  return Math.max(1, toWindowEnd);
}

/** UTC calendar day "YYYY-MM-DD". */
export function utcDay(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

let isolateSalt: string | null = null;

/**
 * The salt to use: `IP_SALT`, or (if the secret is not configured) a random per-isolate salt so a
 * missing secret never weakens privacy; rate limiting then only holds within one isolate.
 */
export function effectiveSalt(secret: string | undefined): string {
  if (secret && secret.length >= 8) return secret;
  if (!isolateSalt) {
    const b = new Uint8Array(32);
    crypto.getRandomValues(b);
    isolateSalt = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  }
  return isolateSalt;
}

/** SHA-256(salt | day | ip) as 64 hex chars. */
export async function hashClient(ip: string, salt: string, day: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}|${day}|${ip}`));
  return Array.from(new Uint8Array(digest), (x) => x.toString(16).padStart(2, '0')).join('');
}

/** The client IP Cloudflare reports (never stored). */
export function clientIp(request: Request): string {
  return request.headers.get('CF-Connecting-IP') ?? request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ?? 'unknown';
}

export interface RateDecision {
  allowed: boolean;
  /** Seconds to wait when not allowed. */
  retryAfter: number;
  /** Window start (unix s) to count an allowed request in (see `countStatement`). */
  windowStart: number;
}

/**
 * Check the client's limit: one D1 batch that purges rows older than 24 hours and reads the
 * current and previous windows. Nothing is counted yet; add `countStatement` to the write batch
 * of an allowed request so the count and the vote commit together.
 */
export async function check(db: D1Database, key: string, nowSec: number): Promise<RateDecision> {
  const start = windowStart(nowSec);
  const [, rows] = await db.batch<{ window_start: number; count: number }>([
    db.prepare('DELETE FROM rate_limit WHERE window_start < ?1').bind(nowSec - RATE_LIMIT.retentionSec),
    db.prepare('SELECT window_start, count FROM rate_limit WHERE hash = ?1 AND window_start IN (?2, ?3)').bind(key, start, start - RATE_LIMIT.windowSec),
  ]);
  let current = 0;
  let previous = 0;
  for (const r of rows?.results ?? []) {
    if (Number(r.window_start) === start) current = Number(r.count);
    else previous = Number(r.count);
  }
  const ok = allowed(current, previous, nowSec);
  return { allowed: ok, retryAfter: ok ? 0 : retryAfterSec(current, previous, nowSec), windowStart: start };
}

/** The statement that counts one request in the client's current window. */
export function countStatement(db: D1Database, key: string, windowStartSec: number) {
  return db
    .prepare('INSERT INTO rate_limit (hash, window_start, count) VALUES (?1, ?2, 1) ON CONFLICT (hash, window_start) DO UPDATE SET count = count + 1')
    .bind(key, windowStartSec);
}
