import { describe, expect, it } from 'vitest';
import { allowed, clientIp, effectiveSalt, hashClient, RATE_LIMIT, retryAfterSec, slidingCount, utcDay, windowStart } from '../../functions/_lib/ratelimit';

const H = RATE_LIMIT.windowSec;
const T0 = 1_793_923_200; // a window boundary (multiple of 3600)

describe('window math', () => {
  it('fixed windows', () => {
    expect(T0 % H).toBe(0);
    expect(windowStart(T0)).toBe(T0);
    expect(windowStart(T0 + H - 1)).toBe(T0);
    expect(windowStart(T0 + H)).toBe(T0 + H);
  });

  it('sliding count weights the previous window by its remaining overlap', () => {
    expect(slidingCount(10, 0, T0 + 100)).toBe(10);
    expect(slidingCount(0, 30, T0)).toBe(30);
    expect(slidingCount(0, 30, T0 + H / 2)).toBe(15);
    expect(slidingCount(5, 30, T0 + (3 * H) / 4)).toBeCloseTo(12.5, 9);
  });

  it('allows 30 per rolling hour and refuses the 31st', () => {
    let current = 0;
    for (let i = 0; i < RATE_LIMIT.limit; i++) {
      expect(allowed(current, 0, T0 + i)).toBe(true);
      current++;
    }
    expect(allowed(current, 0, T0 + 40)).toBe(false);
    // No boundary burst: 30 at the end of one window still block early in the next.
    expect(allowed(0, 30, T0 + H + 60)).toBe(false);
    // ... but capacity comes back as the old window slides out.
    expect(allowed(0, 30, T0 + H + H / 2)).toBe(true);
  });

  it('retry-after points at the first second a request would pass', () => {
    const now = T0 + 600;
    expect(retryAfterSec(30, 0, now)).toBe(H - 600); // full window: wait for it to end
    const prev = 30;
    const cur = 10;
    const wait = retryAfterSec(cur, prev, now);
    expect(allowed(cur, prev, now + wait)).toBe(true);
    expect(allowed(cur, prev, now + wait - 2)).toBe(false);
    expect(retryAfterSec(0, 0, T0 + H - 1)).toBeGreaterThanOrEqual(1);
  });
});

describe('client hashing (privacy)', () => {
  it('is a salted SHA-256 that rotates with the UTC day', async () => {
    const a = await hashClient('203.0.113.7', 'salt-aaaaaaaa', '2026-11-06');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toContain('203');
    expect(await hashClient('203.0.113.7', 'salt-aaaaaaaa', '2026-11-06')).toBe(a);
    expect(await hashClient('203.0.113.7', 'salt-aaaaaaaa', '2026-11-07')).not.toBe(a);
    expect(await hashClient('203.0.113.7', 'salt-bbbbbbbb', '2026-11-06')).not.toBe(a);
    expect(await hashClient('203.0.113.8', 'salt-aaaaaaaa', '2026-11-06')).not.toBe(a);
  });

  it('utcDay', () => {
    expect(utcDay(Date.UTC(2026, 10, 6, 23, 59, 59))).toBe('2026-11-06');
    expect(utcDay(Date.UTC(2026, 10, 7, 0, 0, 0))).toBe('2026-11-07');
  });

  it('never hashes without a secret salt: a missing IP_SALT gets a random per-isolate salt', () => {
    expect(effectiveSalt('configured-secret')).toBe('configured-secret');
    const s = effectiveSalt(undefined);
    expect(s).toMatch(/^[0-9a-f]{64}$/);
    expect(effectiveSalt('')).toBe(s);
    expect(effectiveSalt('short')).toBe(s);
  });

  it('reads the IP Cloudflare reports', () => {
    expect(clientIp(new Request('https://x/', { headers: { 'CF-Connecting-IP': '198.51.100.4' } }))).toBe('198.51.100.4');
    expect(clientIp(new Request('https://x/', { headers: { 'X-Forwarded-For': '198.51.100.5, 10.0.0.1' } }))).toBe('198.51.100.5');
    expect(clientIp(new Request('https://x/'))).toBe('unknown');
  });
});
