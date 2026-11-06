/**
 * Vote rate limiting: 120 votes per rolling hour per client, keyed by a salted hash of the client's
 * network address (the full IPv4 address, or the /64 prefix of an IPv6 address).
 *
 * Privacy (SPEC house rule 6): the IP is never stored. A window's key is
 * SHA-256(salt | UTC day of that window | address) with the secret `IP_SALT`; mixing in the day
 * rotates the salt daily, so keys cannot be linked across days. Rows are deleted 24 hours after
 * their window starts (on every vote and event write, and by the daily purge workflow).
 *
 * Counting uses fixed one-hour windows with the sliding-window approximation: the previous window's
 * count is weighted by how much of it still overlaps the last hour. The previous window is looked up
 * under its own day's key, so the limit carries across midnight UTC.
 *
 * Atomicity: `voteBatch` counts the attempt and writes the vote in ONE D1 batch (one serialized
 * transaction); the vote statements only insert when the count, read inside the same transaction,
 * is within the limit. Concurrent requests therefore cannot all read a stale count. Refused attempts
 * are counted too, so a client that keeps sending while refused stays refused.
 */
import type { D1Database, D1PreparedStatement } from './cf';

export const RATE_LIMIT = Object.freeze({
  /** Votes allowed per rolling window: four 30-round runs, or eight standard runs, per hour. */
  limit: 120,
  /** Window length (s). */
  windowSec: 3600,
  /** Rate-limit rows are deleted this long after their window starts (s). */
  retentionSec: 24 * 3600,
});

/** Start (unix s) of the fixed window containing `nowSec`. */
export function windowStart(nowSec: number, windowSec: number = RATE_LIMIT.windowSec): number {
  return Math.floor(nowSec / windowSec) * windowSec;
}

/** Weight (0..1] of the previous window in the rolling hour ending at `nowSec`. */
export function previousWeight(nowSec: number, windowSec: number = RATE_LIMIT.windowSec): number {
  const elapsed = nowSec - windowStart(nowSec, windowSec);
  return Math.max(0, (windowSec - elapsed) / windowSec);
}

/** Estimated requests in the rolling window ending now. */
export function slidingCount(current: number, previous: number, nowSec: number, windowSec: number = RATE_LIMIT.windowSec): number {
  return current + previous * previousWeight(nowSec, windowSec);
}

/**
 * Whether one more request is allowed, given the requests already counted in the current window
 * and the previous window's count.
 */
export function allowed(current: number, previous: number, nowSec: number, limit: number = RATE_LIMIT.limit, windowSec: number = RATE_LIMIT.windowSec): boolean {
  return slidingCount(current + 1, previous, nowSec, windowSec) <= limit;
}

/**
 * Seconds until one more request would be allowed (for Retry-After): when the weighted previous
 * window has decayed enough, else when the current window ends. At least 1.
 */
export function retryAfterSec(current: number, previous: number, nowSec: number, limit: number = RATE_LIMIT.limit, windowSec: number = RATE_LIMIT.windowSec): number {
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

/** SHA-256(salt | day | address) as 64 hex chars. */
export async function hashClient(address: string, salt: string, day: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}|${day}|${address}`));
  return Array.from(new Uint8Array(digest), (x) => x.toString(16).padStart(2, '0')).join('');
}

/** The client IP Cloudflare reports (never stored). */
export function clientIp(request: Request): string {
  return request.headers.get('CF-Connecting-IP') ?? request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ?? 'unknown';
}

/** Expand an IPv6 address to 8 hextets (numbers), or null if it is not one. Handles `::`, zones and an embedded IPv4 tail. */
export function ipv6Hextets(ip: string): number[] | null {
  let s = ip.trim().toLowerCase();
  if (s.startsWith('[') && s.endsWith(']')) s = s.slice(1, -1);
  const zone = s.indexOf('%');
  if (zone >= 0) s = s.slice(0, zone);
  if (!s.includes(':') || !/^[0-9a-f:.]+$/.test(s)) return null;
  // Embedded IPv4 tail (e.g. ::ffff:192.0.2.1) -> two hextets.
  const v4 = s.match(/^(.*:)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const o = v4.slice(2, 6).map(Number);
    if (o.some((x) => x > 255)) return null;
    s = `${v4[1]}${((o[0]! << 8) | o[1]!).toString(16)}:${((o[2]! << 8) | o[3]!).toString(16)}`;
  }
  const parts = s.split('::');
  if (parts.length > 2) return null;
  const head = parts[0] ? parts[0].split(':') : [];
  const tail = parts.length === 2 && parts[1] ? parts[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (parts.length === 1 ? head.length !== 8 : missing < 1) return null;
  const all = [...head, ...Array<string>(parts.length === 2 ? missing : 0).fill('0'), ...tail];
  if (all.some((h) => !/^[0-9a-f]{1,4}$/.test(h))) return null;
  return all.map((h) => parseInt(h, 16));
}

/**
 * The part of the client address the limit applies to: a full IPv4 address, or the /64 prefix of
 * an IPv6 address (one home connection or server gets a whole /64 and can rotate the rest freely).
 * IPv4-mapped IPv6 addresses count as their IPv4 address. Anything else is used as given.
 */
export function rateKeyAddress(ip: string): string {
  const h = ipv6Hextets(ip);
  if (!h) return ip.trim();
  if (h.slice(0, 5).every((x) => x === 0) && h[5] === 0xffff) {
    return `${h[6]! >> 8}.${h[6]! & 255}.${h[7]! >> 8}.${h[7]! & 255}`;
  }
  return `${h.slice(0, 4).map((x) => x.toString(16)).join(':')}::/64`;
}

/** The two keys a vote needs: the current window's (under its UTC day) and the previous window's (under its own day). */
export interface WindowKeys {
  current: string;
  previous: string;
  /** Current window start (unix s). */
  start: number;
}

export async function windowKeys(address: string, salt: string, nowSec: number): Promise<WindowKeys> {
  const start = windowStart(nowSec);
  const prevStart = start - RATE_LIMIT.windowSec;
  const day = utcDay(start * 1000);
  const prevDay = utcDay(prevStart * 1000);
  const current = await hashClient(address, salt, day);
  const previous = prevDay === day ? current : await hashClient(address, salt, prevDay);
  return { current, previous, start };
}

/** Statement: delete rate-limit rows whose window started more than 24 hours ago. */
export function purgeStatement(db: D1Database, nowSec: number): D1PreparedStatement {
  return db.prepare('DELETE FROM rate_limit WHERE window_start < ?1').bind(nowSec - RATE_LIMIT.retentionSec);
}

/** A write that runs only when the attempt is within the limit (see `voteBatch`). */
export interface GuardedWrite {
  /** `INSERT INTO t (cols) SELECT ?1, ?2, ...` without a WHERE clause: `voteBatch` appends the guard. */
  insertSelect: string;
  /** Text after the guard, e.g. an `ON CONFLICT (...) DO UPDATE SET ...` upsert clause. */
  tail?: string;
  /** Values for ?1..?n of `insertSelect`. */
  params: unknown[];
}

export interface VoteDecision {
  allowed: boolean;
  /** Seconds to wait when not allowed (0 when allowed). */
  retryAfter: number;
  /** Count in the current window after this attempt. */
  current: number;
  previous: number;
}

/**
 * Count one attempt for the client and run `writes` only if it is within the limit, atomically.
 *
 * One D1 batch: purge old rows; upsert-increment the current window's count; each guarded write as
 * `INSERT ... SELECT ... WHERE <count after this attempt, plus the weighted previous window, is
 * within the limit>`; finally read both counts so the caller can answer. D1 runs a batch as one
 * transaction and serializes transactions, so the guard always sees every earlier attempt.
 */
export async function voteBatch(db: D1Database, keys: WindowKeys, nowSec: number, writes: GuardedWrite[], limit: number = RATE_LIMIT.limit): Promise<VoteDecision> {
  const weight = previousWeight(nowSec);
  const prevStart = keys.start - RATE_LIMIT.windowSec;
  const countOf = (k: number, w: number) => `(SELECT count FROM rate_limit WHERE hash = ?${k} AND window_start = ?${w})`;
  const guarded = writes.map((w) => {
    const n = w.params.length;
    // Guard parameters follow the write's own: ?n+1 current hash, ?n+2 current start,
    // ?n+3 previous hash, ?n+4 previous start, ?n+5 weight, ?n+6 limit.
    const guard = `COALESCE(${countOf(n + 1, n + 2)}, 0) + COALESCE(${countOf(n + 3, n + 4)}, 0) * ?${n + 5} <= ?${n + 6}`;
    return db.prepare(`${w.insertSelect} WHERE ${guard}${w.tail ? ` ${w.tail}` : ''}`).bind(...w.params, keys.current, keys.start, keys.previous, prevStart, weight, limit);
  });
  const results = await db.batch<{ current: number | null; previous: number | null }>([
    purgeStatement(db, nowSec),
    db
      .prepare('INSERT INTO rate_limit (hash, window_start, count) VALUES (?1, ?2, 1) ON CONFLICT (hash, window_start) DO UPDATE SET count = count + 1')
      .bind(keys.current, keys.start),
    ...guarded,
    db.prepare(`SELECT ${countOf(1, 2)} AS current, ${countOf(3, 4)} AS previous`).bind(keys.current, keys.start, keys.previous, prevStart),
  ]);
  const row = results[results.length - 1]?.results?.[0];
  const current = Number(row?.current ?? 0);
  const previous = Number(row?.previous ?? 0);
  // `current` already includes this attempt: it was allowed iff (current - 1) + 1 + previous * w <= limit.
  const ok = slidingCount(current, previous, nowSec) <= limit;
  return { allowed: ok, retryAfter: ok ? 0 : retryAfterSec(current, previous, nowSec, limit), current, previous };
}

/* ------------------------------------------------------------------ in-memory limiter (events) */

/**
 * A per-isolate fixed-window counter for endpoints where a D1 write per check would cost more than
 * it saves (POST /api/event). It holds only salted hashes, in memory, for at most one window, and
 * forgets everything when it grows past `maxKeys`. Each Cloudflare isolate counts separately, so it
 * caps one script hammering the site rather than giving an exact global limit.
 */
export class MemoryLimiter {
  private window = -1;
  private counts = new Map<string, number>();

  constructor(
    readonly limit: number,
    readonly windowSec: number,
    readonly maxKeys = 10_000,
  ) {}

  /** Count one request for `key`; false when it is over the limit. */
  hit(key: string, nowSec: number): boolean {
    const w = windowStart(nowSec, this.windowSec);
    if (w !== this.window || this.counts.size >= this.maxKeys) {
      this.window = w;
      this.counts.clear();
    }
    const n = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, n);
    return n <= this.limit;
  }
}
